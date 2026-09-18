# Native concurrency plan review — 2026-09-18

Scope: review of the user-attached native decoder concurrency investigation plan against the current working tree. This is a research-plan review, not authorization or evidence of successful concurrent extraction.

Verdict: proceed with a bounded feasibility investigation after the amendments below. Keep production sequential until attribution, cancellation, and recovery gates pass. Independent native source construction remains unproven.

Evaluation rubric: factual grounding; exact attribution; lifecycle safety; preservation of process ownership; experiment validity; proportionate complexity and measurable benefit.

## Findings

### 1. Correct the data-flow and acceleration assumptions before choosing the target architecture

`soggfy-macos/Payload/DecodeHook.mm:41-48` describes encoded Ogg input and PCM output. The page hook copies pages supplied to `ogg_stream_pagein` (`:286-303`); decoding does not generate the Ogg artifact. Model the target as native source/read path → encoded Ogg → decoder → PCM, with capture branching from the encoded stream.

The current acceleration mechanism is also already visible: the hook divides the returned sample count by the global speed (`:468-475`). This is not evidence of a native per-context speed setting or detached-sink capability. Investigate upstream data delivery and scheduling before committing to constructor replication or maximum-rate decoding. A usable independent source could potentially avoid unnecessary PCM work, but that is a hypothesis to test, not an established alternative.

The mutation guard does not match `x0` to the selected extraction context. Even if every worker uses the same speed, ordinary playback could be affected. Require context-scoped mutation and an ordinary-playback-plus-extraction test before sharing the process this way.

### 2. Add lifecycle and recovery gates before production ownership changes

The plan postpones ownership changes until two successful streams, but successful completion does not establish safe cancellation. `webapp/src/server/pool.ts:126-132` cancels by track, pauses playback, and recycles the instance. Those actions would affect all contexts in a shared process.

Require a per-context lifecycle with explicit creation, running, draining, cancellation, failure and completion transitions. Specify callback lifetime, thread affinity, reference ownership, teardown acknowledgement, and rejection of late callbacks. Test cancelling A while B completes, duplicate subscribers with one cancellation, source failure, writer failure, and process restart.

A native crash cannot be contained by an in-process context map. Replace the absolute promise that one experimental decoder cannot corrupt another with a measurable recovery contract: completed validated files remain intact; incomplete outputs remain uncommitted; a process failure invalidates all live contexts and permits controlled requeue. Run invasive experiments in an isolated test runtime.

### 3. Separate stream identity, artifact identity and process ownership

`unordered_map<Decoder*, CaptureContext>` is insufficient as the authoritative identity. Pointer addresses can recur across lifetimes, and a seek/restart can replace the logical stream. Existing investigation capture already keys on decoder, Ogg state and serial, assigns a generation, and handles replacement at BOS (`DecodeHook.mm:175-204,235-266`).

Use a process generation and context/stream generation as durable correlation identities. Keep pointers and serials as observations, and bind the verified exact variant separately. Correlating overlapping storage requests by timing alone must remain unverified. Explicitly cover missing/late identity, same-track repeat, pointer reuse, and serial collision.

Keep one authoritative daemon/runtime owner while granting per-capture writer leases. `.capture-owner` currently coordinates process identity, process birth identity, track and source (`StateManager.cpp:223-249`); replacing it with only an in-memory map would discard cross-process protection. Deduplicated file acquisition also needs subscriber-aware cancellation and separate publication/metadata handling where output requests differ.

### 4. Strengthen C3 beyond overlapping object lifetimes

Require both contexts to make observable input/page progress during an overlapping interval, with complete exact-variant outputs and no dependence on global active playback for attribution. Merely overlapping lifetimes can include an idle or queued context. Simultaneous CPU execution is not required; useful concurrent progress is.

Define fixture provenance before testing: exact file ID, format, build, baseline capture and SHA-256. Canonical hashes must come from the established sequential path, not the experimental attribution path. Retain complete-stream checks and output validation alongside hashes. Include repeated runs and adversarial lifecycle cases before production integration.

### 5. Benchmark against the best current sequential path

The comparator should be prefetch-enabled sequential extraction at the same supported speed and exact variants. Comparing against prefetch-disabled capture would confound the benefit already delivered with the proposed concurrency gain.

The saved prefetch results report two recovered baseline retries; the retry-free pair improved 9.065%, while the headline median improved 60.043% (`investigations/spotify-1.3.0.277-streamer/RESULTS.md:12-28`). These are saved results, not freshly reproduced measurements. They support the implemented combined optimization, not a prediction that parallel decoders scale linearly or that CPU is the limiting factor.

Separate warm-cache extraction measurements from cold-cache end-to-end measurements. Alternate paired order, hold speed and variants fixed, count retry costs, measure interactive latency, and set the minimum useful gain before running. Start with fixed widths 1 and 2; widen only after a repeatable benefit. Adaptive sizing can wait.

### 6. Bound and pin the investigation

Retain exact-build gating and add executable identity, architecture and address provenance to the experiment manifest. The current decoder/Ogg layout is gated specifically to 1.3.0.277 (`DecodeHook.mm:525-532`), while HANDOVER records a different normal runtime build.

Prefer first-use stacks and bounded event records over exhaustive expensive tracing. Existing investigation writing uses a shared mutex and synchronous file writes; account for its effect on throughput. Restrict object snapshots to needed fields and keep keys, authentication material and raw memory out of semantic-supervision inputs. TypeSafe may critique experiment design, but deterministic assertions and primary evidence own the result.

## Revised execution order

1. Freeze exact-build sequential fixtures and record the best current baseline.
2. Trace source-to-decoder identity, data delivery and lifetimes with bounded instrumentation.
3. Prove one independently driven native source/context through clean completion and teardown.
4. Prove two contexts make overlapping progress and match independent fixtures; exercise cancellation and failures.
5. Integrate per-context commands and writer leases while retaining one runtime authority.
6. Benchmark fixed widths against optimized sequential capture; only then consider a larger or adaptive pool.

Stop or retain sequential capture if independent construction requires disproportionate private orchestration or cannot preserve the lifecycle contract. A negative feasibility result is an acceptable completed investigation.

## Verification boundary

Reviewed the attached plan, current source, HANDOVER and saved investigation evidence. No production code changed, no live Spotify experiments ran, and no historical test or benchmark result was independently rerun. Existing uncommitted work was preserved. Documentation whitespace was checked for this review.
