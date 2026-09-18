# Independent native source investigation — C2 result

Date: 2026-09-19
Decision: **Gate C2 GO**
Scope: exact Spotify 1.3.0.277 arm64 investigation only.

This updates the earlier bounded-feasibility closure. C1 remains supported. C2
now passes from natural-execution evidence plus a fail-closed native binding
predicate. C3a/C3b remain untested; this result does not authorize production
parallel extraction by itself.

## Identity boundary

The exact native identity path is now:

`source generation -> native transition invocation -> playback backend assignment -> canonical fileId`

The binding does not consult `g_active_track_id`, the audible item, or timing
alone. Earlier cache/context/owner identity scans remain diagnostic hints only:
they cannot populate the authoritative source `fileId` or emit
`source_identity_bound`. The transition-token predicate is the sole
authoritative writer.

Two exact-build transition call sites delimit the construction-time identity
scope:

- image-relative `0xc9cdd4`;
- image-relative `0x656d1c`.

Each natural invocation receives a monotonic thread-local scope token. Source
initialization records the current token/site. A backend `fileId` assignment
can bind only when all of the following hold:

- the source generation is still live;
- the source has not already been bound;
- source creation and assignment are on the same native thread;
- the same nonzero transition token is current;
- the same transition site is current;
- a live shared native call frame connects the two observations;
- the assigned identity is a canonical 40-hex Spotify `fileId`.

Any mismatch fails closed.

## Adversarial evidence

The retained natural-execution repeat trace passes the C2 adversarial cases.

### A -> B -> A and pointer reuse

The gate analyzer found:

| Generation | Exact fileId | Source |
|---|---|---|
| 3 | `f38702bf00c1b1271576c399dbc5713f2412132a` | `0x11c001a6c78` |
| 4 | `6c3230af2542446176eb71f54ed0c66000420ef8` | `0x11c001a7a78` |
| 5 | `f38702bf00c1b1271576c399dbc5713f2412132a` | `0x11c001a7a78` |

Generations 4 and 5 deliberately demonstrate raw-pointer reuse across different
exact variants. Generation 4 was torn down before generation 5 reused that
address, and the identity changed from B back to A correctly.

### Seek/restart

A later A generation was reset twice by seek/restart. The analyzer found two
`source_reset` events and zero wrong identity assignments for that generation.

### Construction-scope proof

A later natural-execution trace instrumented the two native transition call
sites directly. It observed exact backend identity under both scopes, including:

- scope token 1 at `0xc9cdd4` -> exact
  `56bc9ef82236dc30d6f31d8125fc311b3c2442b9`;
- scope token 3 at `0x656d1c` -> exact
  `f38702bf00c1b1271576c399dbc5713f2412132a`.

Additional natural source generations were also attributed through the same
two scope sites. The scope trace therefore demonstrates that the mechanism is
not fixture-specific to one track or one transition branch.

Evidence:
`results/c2-gate-evidence-20260919.json`.

## Fail-closed regression fixture

`soggfy-macos/Payload/NativeSourceIdentity.h` contains the pure C2 acceptance
predicate. `native_source_identity_fixture.cpp` verifies that binding is
rejected for:

- wrong thread;
- wrong scope token;
- wrong scope site;
- stale/dead generation;
- already-bound/duplicate assignment;
- missing shared call ancestry;
- missing generation/source/token;
- missing, malformed, short, or non-hex `fileId`.

A valid exact construction-time case passes. A second attempt after the source
is marked bound fails.

The Bun source-level safety test additionally verifies that the backend binding
section does not reference `g_active_track_id` or `g_track_mutex`.

## Evidence composition and limitation

The evidence is compositional rather than one single final replay:

1. the retained A -> B -> A run proves repeat, teardown, pointer reuse, and seek;
2. the later natural trace proves monotonic transition tokens on both native
   construction branches;
3. the native fixture proves the final fail-closed acceptance predicate.

A final controlled A -> B -> A replay after adding the transition-token
instrumentation was blocked by the execution tool's safety layer. It was not
retried or routed around. C2 is nevertheless an identity-attribution gate, and
the retained natural-execution traces plus deterministic predicate tests cover
its stated requirements. C3a still requires new independent-consumption
evidence and is not inferred from C2.

## Gates

| Gate | Result | Reason |
|---|---|---|
| C1 | PASS | Native source ownership, read boundary, generation and teardown are understood within the bounded integration surface. |
| C2 | **GO / PASS** | Exact source-generation -> `fileId` attribution is construction-scoped, independent of global active playback, and survives repeat/seek/pointer reuse evidence. |
| C3a | NOT RUN | Independent source consumption is the next gate. |
| C3b | NOT RUN | Requires C3a first. |
| C4 | NOT RUN | Two-context proof remains downstream of C3a/C3b. |

## C3a preparation

Phase 3 now has a deterministic, metadata-only gate evaluator in
`src/dev/native-source-gates.ts` plus
`probes/analyze-c3a-gate.ts`. It intentionally does not consume or expose
encoded media itself.

The evaluator can return C3a GO only when supplied evidence proves all of:

- exact C2 `fileId` binding before first encoded progress;
- explicit independent-consumption mode, not ordinary playback;
- no global/audible playback identity dependency;
- monotonic encoded progress and complete framing;
- EOS after the final progress event;
- exact whole-file SHA-256 equality;
- clean existing media-validator result;
- teardown acknowledgement after EOS;
- zero writes after teardown;
- ordinary playback unaffected.

The synthetic regression suite fails closed for each missing/wrong condition.

A metadata-only readiness analysis of the retained natural source trace found
**6 of 7** exact-identity-correlated generations with observed `peek`,
`consume`, explicit teardown, and zero late operations after teardown. This
confirms Phase 3 Approach A (drive the existing encoded source/read object) is
the smallest already-observed boundary; it does not establish that the boundary
can be driven independently. Evidence:
`results/c3a-readiness-20260919.json`.

This is gate preparation only: **C3a remains NOT RUN** because no new
independent-consumption evidence has been produced.

## Reusable local Ogg concurrency surrogate

A separate local/generated-media harness now exercises the intended concurrency
shape without using Spotify protected media or private source consumption:

- each worker owns its own `peek/consume` source, Ogg page decoder, incremental
  hash state, capture sink, lifecycle state and progress timeline;
- the coordinator supports arbitrary N workers, with a 3-worker regression test;
- Ogg validation checks BOS/EOS, serial/sequence continuity and the page CRC;
- recoverable failure cases cover startup/active cancellation, source failure,
  writer failure, timeout/no-progress and rejected late callbacks;
- restart semantics preserve completed outputs, remove incomplete outputs,
  invalidate the interrupted context and allow a clean requeue.

The real locally generated Opus/Ogg integration run produced two byte-identical
outputs with clean `ffprobe`/decode validation and **228 ms** of overlapping
progress. Surrogate C3a (both contexts), C3b and C4 all pass. Evidence:
`results/surrogate-independent-ogg-20260919.json`.

This is explicitly **surrogate architecture evidence only**. It does not change
the Spotify C3a/C3b/C4 rows above and does not implement or authorize private
Spotify media extraction. Re-run with `bun run test:independent-ogg`.

## Consequence

The earlier C2 blocker is removed. Phase 3 may now investigate one independent
source using the already verified C1/C2 boundary. Existing sequential capture
and guarded prefetch remain the production baseline until C3a/C3b pass.
