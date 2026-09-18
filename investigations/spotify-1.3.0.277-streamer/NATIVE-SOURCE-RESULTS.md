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
alone.

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

## Consequence

The earlier C2 blocker is removed. Phase 3 may now investigate one independent
source using the already verified C1/C2 boundary. Existing sequential capture
and guarded prefetch remain the production baseline until C3a/C3b pass.
