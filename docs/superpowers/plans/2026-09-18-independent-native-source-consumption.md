# Independent native source consumption investigation

Date: 2026-09-18  
Status: closed NO-GO at Gate C2; C1 supported, C2 not established, C3a/C3b not attempted  
Production baseline: optimized sequential capture remains authoritative. Two-context work remains blocked until C1, C2, C3a and C3b pass from primary evidence.

## Closure decision

The bounded feasibility investigation stops at Gate C2.

Natural execution established a repeatable native source/read ownership boundary
and lifecycle sufficient for C1. The investigation then traced exact playback
identity through the native Playback Esperanto service and compared that identity
state with the bounded source graph. No direct structural identity edge was found.
The remaining source-constructor dependencies were narrowed to parent-owned
objects, including one track-varying object, but neither the exact canonical
`fileId` nor its canonical `audioId` was directly present in the bounded objects
that were inspected.

Advancing from here would require recursively reconstructing additional
undocumented playback/metadata object graphs or managers instead of reusing a
small verified source boundary. That crosses this plan's own bounded-investigation
stop criterion. Therefore:

- Gate C1: supported by the retained lifecycle/source-boundary evidence.
- Gate C2: not passed.
- The seek/restart adversarial trace is not promoted to a C2 test because the
  prerequisite exact identity binding was never established.
- Gates C3a/C3b and all two-context work are not attempted.
- No production ownership or concurrency behavior changes are justified by this
  investigation.

The final evidence summary is
`investigations/spotify-1.3.0.277-streamer/NATIVE-SOURCE-RESULTS.md`.

## Objective

Answer one narrow question before choosing any concurrency architecture:

> Can one exact cached Spotify variant be consumed through Spotify's native source path, independently of audible/main-player ownership, with reliable exact identity, complete Ogg capture, bounded teardown and no regression to ordinary playback?

If yes, repeat with two contexts and measure whether both make useful overlapping progress. If reaching one independent context requires reconstructing a large portion of Spotify's private playback engine, stop and retain optimized sequential capture unless measured benefit clearly justifies the compatibility burden.

## Non-goals

This investigation does not assume that decoder-object multiplicity implies independently runnable playback pipelines. It does not require a decoder pool, multiple Spotify processes, a recreated Spotify media stack, or adaptive concurrency. Those are downstream architecture choices, not premises.

The renderer `StandalonePlayerCoordinatorAPI` is not the primary path: observed protected-track resolution uses Spotify's web/MP4/EME route and did not reach the native Ogg/Vorbis interception path.

## Invariants

1. One normal Spotify process remains the production/runtime authority.
2. Existing sequential exact capture remains the fallback and control path.
3. Exact `fileId`/variant identity must be proven independently of global active playback before experimental output can be trusted.
4. Partial/failed experimental output is never published as a completed media artifact.
5. A crash invalidates all live experimental contexts; previously completed validated files remain intact and unfinished jobs are safely requeueable.
6. Ordinary playback and `SOGGFY_PREFETCH=0` behavior must remain unaffected by dormant investigation instrumentation.
7. Deterministic evidence owns gates. TypeSafe may critique narrow semantic judgments but is never a prerequisite for running or validating an experiment.

## Phase 0 — Freeze the best sequential baseline

Use exact Spotify 1.3.0.277 arm64 and canonical fixture variants. Benchmark the best current path, not prefetch-disabled capture:

- exact variant already cached;
- current validated decode-speed path;
- whole-file SHA-256 fixture;
- ffprobe/stream validation;
- every attempted run is retained, including retries/failures;
- retry-free runs are reported separately as steady-state timing, while all-attempt timing remains the reliability/operational result.

Record separately:

- cache acquisition time;
- time from playback/source start to first captured Ogg page;
- time from first Ogg page to EOS;
- total extraction wall time;
- encoded bytes/pages consumed;
- PCM/output scheduling activity;
- CPU and idle gaps where practical.

Purpose: determine whether sequential throughput is actually limited by source delivery, playback pacing, decoder/PCM work, or another shared scheduler before adding concurrency.

Performance diagnosis and reliability reporting are separate:
- steady-state diagnosis may use retry-free runs;
- reliability/operational summaries include every attempted run and all retry cost;
- failed/invalid attempts are never discarded merely because they are inconvenient to timing analysis.

## Phase 1 — Trace the successful native source-to-capture path

Work backward from known-good `DecodeAudioData` / `ogg_stream_pagein` observations using bounded first-use instrumentation.

For each unique logical stream/context, record only bounded metadata:

- process generation;
- monotonic context generation;
- decoder pointer;
- Ogg state pointer;
- Ogg serial;
- thread id;
- first/last timestamps;
- encoded input pointer/length observations;
- BOS/EOS/page sequence/granule progress;
- first-use native backtrace addresses;
- object pointers passed by immediate callers;
- lifecycle create/reuse/destroy observations.

Do not dump raw protected media, auth material, keys, or arbitrary memory to semantic-supervision inputs.

Controlled traces:

1. cached A sequential capture;
2. uncached A capture;
3. A -> B transition;
4. A -> B -> A repeat;
5. seek/restart of A;
6. cached 16x A versus baseline-speed A.

Deliverable: a minimal caller/owner graph around the source that feeds the native Ogg/Vorbis decode path.

## Gate C1 — Native ownership/source boundary understood

PASS only when the evidence can distinguish:

- logical stream lifetime from pointer reuse;
- source/read ownership from decoder/PCM ownership;
- where encoded Ogg bytes enter the successful native path;
- what creates and tears down the owning context;
- which operations that the proposed independent-source experiment relies on are process-global versus context-local.

If this cannot be established with bounded instrumentation, stop before constructor replication.

### Operational definition of bounded investigation

Before directly invoking any private native function or method, all of the following must be established from natural Spotify execution:

1. **Calling convention:** argument count/register roles and return behavior are observed consistently in at least two natural invocations.
2. **Ownership/refcount:** the creator/owner of returned or passed objects and the corresponding release/destruction behavior are observed; do not guess retain/release semantics.
3. **Execution context:** the required thread/queue/run-loop affinity is identified from natural calls.
4. **Teardown:** a natural or explicit teardown path is identified and can be detected as complete; absence of late callbacks/writes is part of teardown evidence.
5. **Identity:** any source object used experimentally is already bound to an exact `fileId` under C2 or is used only for non-publishing observation.

The permitted private integration surface for the first independent-source experiment is intentionally small: at most one source-construction/acquisition boundary, one read/advance/drive boundary, one teardown boundary, and one scheduler/callback boundary if required. If success requires reconstructing additional cross-cutting playback orchestration, guessing object layouts/refcounts, or coordinating several undocumented managers, classify the surface as broad and stop before expanding it.

One successful run is not evidence of stability. A candidate boundary is considered repeatable only after at least three clean runs spanning at least two canonical fixture tracks with identical lifecycle observations and no unexplained pointer/ownership divergence.

## Phase 2 — Bind source/stream identity to the exact Spotify variant

The authoritative identity must not be `g_active_track_id` or timing correlation alone.

Preferred evidence order:

1. exact `fileId` directly present/reachable in the native source owner;
2. stable source handle/object that can be deterministically bound to a renderer/storage request for the exact `fileId`;
3. construction-time binding where one verified exact variant creates one native source/context.

Use `(process generation, context generation)` as durable correlation identity. Decoder/Ogg pointers and serials are observations within that lifetime, not persistent identities by themselves.

Adversarial cases:

- same track repeated;
- pointer reuse after teardown;
- seek/restart replacing Ogg stream state;
- late callbacks after teardown;
- wrong/missing file identity;
- duplicate request for the same exact variant.

## Gate C2 — Exact identity independent of audible playback

PASS only when a native stream can be attributed to the exact expected `fileId` without consulting global active playback and the attribution survives repeat/seek/pointer-reuse tests.

No production ownership changes before C2 passes.

## Phase 3 — Determine whether the native source can be consumed independently

Test the smallest usable boundary discovered by C1/C2. Prefer reusing an existing Spotify source/read object over constructing decoder/player machinery.

Approaches, in order:

### A. Drive an existing native encoded source/read object

If the discovered source exposes a read/pull/advance operation, attempt to consume a fully cached exact variant while the audible player is idle or playing another control track.

The experiment is **not required to pass through `DecodeAudioData` or the existing `ogg_stream_pagein` hook**. If independent source consumption bypasses that observation point, install a separate investigation-only collector at the verified encoded-source boundary. That collector must preserve the exact encoded byte/page framing supplied by Spotify, track ordering and completeness, and validate the reconstructed artifact with:
- Ogg BOS/EOS/page-sequence/granule checks where that framing is available;
- total encoded byte/range coverage where the source boundary is below page framing;
- whole-file SHA-256 against the canonical sequential fixture;
- independent media validation (`ffprobe`/existing validator).

Failure of the existing Ogg hook to fire is therefore not, by itself, evidence that a native source cannot be consumed independently.

Success means the verified encoded source makes progress and yields the exact canonical artifact without making that variant the global active playback item.

### B. Reuse a compact native source factory

If source construction is self-contained and takes a stable exact file/storage identity, invoke that factory with a cached variant and drive the resulting source through normal consumption/teardown.

### C. Instantiate the smallest self-contained native playback/decode context

Only if A/B are unavailable. Identify required scheduler/callback/audio-clock dependencies explicitly. Avoid reproducing private orchestration unless the dependency surface remains small and stable.

### D. Stop

If independent consumption requires reconstructing broad private playback state, reference-counting rules, scheduler plumbing, audio-sink behavior and source management, record the negative result and retain optimized sequential capture.

## Gate C3a — One independent source succeeds

PASS only if one exact cached variant can be consumed independently with all of:

- exact file identity established before publication;
- observable encoded-page progress;
- complete EOS;
- canonical whole-file SHA-256 match;
- clean media validation;
- explicit teardown acknowledgement;
- no late writes after teardown;
- ordinary playback unaffected in a simultaneous control test.

## Phase 4 — Lifecycle and failure semantics for one context

Before adding a second context, exercise:

- cancel during startup;
- cancel during active source consumption;
- source read failure;
- writer failure;
- timeout/no-progress;
- process restart;
- late callback after teardown;
- duplicate subscribers where one subscriber cancels.

Define context states explicitly: resolving -> ready -> consuming -> draining -> completed, with cancelled/failed terminal paths.

Failure testing is divided into two classes:

**Recoverable context failures** — cancellation, source-read failure, writer failure, timeout/no-progress and late callbacks. These must not terminate or materially disrupt ordinary playback in the same Spotify process, and teardown must complete without late writes.

**Process failures** — deliberate/reproduced Spotify crash or forced restart. These may interrupt ordinary playback because the whole process is lost. Their recovery contract is different: completed validated artifacts remain intact, incomplete artifacts remain unpublished, all live experimental contexts are invalidated, and jobs can be cleanly requeued after the normal process is restored.

## Gate C3b — One-context lifecycle is bounded and recoverable

PASS only when:
- all recoverable context-failure tests leave ordinary playback running and uncorrupted;
- all process-failure tests preserve committed artifacts, reject incomplete outputs and permit clean process/job recovery.

## Phase 5 — Two-context proof

Only after C3a/C3b.

Use two independently verified exact cached variants A and B with canonical sequential fixtures.

Require an overlapping interval in which both contexts make useful progress. Overlapping object lifetimes alone do not count.

For each page/progress event record:

- context generation;
- exact fileId binding;
- decoder/Ogg pointers and serial;
- monotonic timestamp;
- page sequence/granule progress;
- output writer identity.

Success criteria:

- A and B both advance during the same wall-clock interval;
- neither depends on global active playback for attribution;
- A SHA-256 equals canonical A;
- B SHA-256 equals canonical B;
- both media validations pass;
- no page/writer cross-attribution;
- cancelling A does not stop/corrupt B;
- failure of A does not mispublish B.

## Gate C4 — Two-way concurrent progress is real and useful

PASS requires repeated correct two-context runs plus lifecycle adversarial cases. This gate proves feasibility, not production worth.

## Phase 6 — Benchmark whether concurrency is worth maintaining

Comparator: the fastest **validated** current sequential extraction path under an equivalent workload.

Equivalent means:
- identical exact variants/file IDs;
- identical warm/cold cache condition for the paired comparison;
- identical required final artifact and validation;
- identical ordinary-playback/interactive constraints;
- identical publication semantics.

Match decode-speed settings only when both approaches use the same pacing mechanism. A directly consumed source may have no meaningful `16x` setting; it should not be penalized or distorted to imitate the control's implementation detail.

Measure paired widths 1 versus 2 first, alternating order. Separate warm-cache extraction from cold-cache end-to-end measurements.

Metrics:

- fixed-batch wall time;
- per-track latency;
- CPU and memory;
- cache/network time;
- extraction time;
- retry/failure count;
- interactive playback latency;
- process crash/recycle incidence;
- exact output correctness.

Only widen past two after repeatable benefit; do not assume linear scaling.

The benchmark decision policy is fixed **before** running the paired concurrency benchmark:
- minimum 5 valid paired width-1/width-2 runs, alternating order;
- retain and report every attempted run, including retries/failures;
- steady-state timing is reported from retry-free valid pairs separately from all-attempt operational timing;
- median warm-cache fixed-batch wall-time improvement must be at least **20%**;
- at least **4 of 5** valid pairs must improve;
- zero wrong/misattributed/incomplete outputs;
- zero additional experimental context failures versus the sequential control;
- ordinary interactive playback/control latency must not materially regress (predeclared tolerance: no more than 10% or 250 ms, whichever is larger, on the measured interaction).

If these criteria are not met, concurrency is not production-worthy even if C4 proves it technically possible.

## Production decision

Adopt independent native source consumption only if:

1. C1 through C4 pass deterministically;
2. the source/context integration boundary is small enough to validate across supported Spotify versions;
3. measured throughput/latency improvement materially exceeds the maintenance and shared-failure cost;
4. sequential capture remains a reliable fallback.

Otherwise keep the now-faster prefetched sequential implementation. A well-evidenced negative result is a successful completion of this investigation.

## Semantic supervision usage

TypeSafe is optional assistance for narrow judgments such as:

- whether an experiment actually distinguishes two hypotheses;
- whether evidence justifies promoting a hypothesis to a supported claim;
- whether a proposed next experiment meaningfully reduces the unresolved uncertainty;
- whether final wording overstates the measured scope.

Hard gates remain ordinary code/assertions over traces, hashes, versions, timings and lifecycle state.
