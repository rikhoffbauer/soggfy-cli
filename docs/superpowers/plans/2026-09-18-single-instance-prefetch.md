# Single-instance prefetch implementation plan

Date: 2026-09-18. Status: **completed**. Gate B is GO; phases 3–6 implemented and live-accepted for exact Spotify 1.3.0.277 with prefetch default-off.
Specification: [single-instance prefetch design](../specs/2026-09-18-single-instance-prefetch-design.md).
Measured outcome: `investigations/spotify-1.3.0.277-streamer/RESULTS.md`.
Derived semantic supervision contract (non-normative): [TypeSafe contract](../supervision/2026-09-18-single-instance-prefetch.json) and [usage](../supervision/README.md).

## Execution contract

Phases 1–2 established the deterministic performance/correctness gate before production scheduling changes. The canonical Gate B run passed, authorizing the implementation below. This plan does not authorize an unbounded search for parallel native extraction. Preserve current dirty investigation files and unrelated edits; inspect current diffs before each change. Keep HANDOVER.md current at phase boundaries. Do not claim CLI playlist acceleration: its one-at-a-time submission is explicitly outside the initial increment.

## 1. Make the investigation reproducible and restore a known environment

Inputs: `investigations/spotify-1.3.0.277-streamer/{probes,schemas,ghidra,results}`, current `DecodeHook.mm` diff, compatibility registry, reported experiments.

- Write the investigation README/results summary with exact binary/schema fingerprints, tool prerequisites, commands derived from each probe's actual arguments, environment settings and expected outputs. Distinguish supplied report claims from locally reproduced results.
- Review relative imports and readiness handling; preserve failing trial records labeled invalid. Do not turn old reports into freshly verified results.
- Review native context instrumentation for disabled-path equivalence, bounded files/state, pointer reuse, serial lifecycle, synchronization and cleanup. Correct defects with native fixtures where feasible. Do not generalize the exact-build `decoder + 0x88` observation to other builds.
- Inspect daemon PID/birth identity, process tree, owned sockets/ports and exact executable/profile paths. Stop only proven investigation owners when cleaning up. Establish restoration in a finally-style runner so failed benchmarks also restore normal operation.
- Verify the normal daemon's actual configured Spotify version from runtime evidence rather than assuming the older report is still current.

Exit: reproducible probes and documented operational state; no untracked experiment process ownership. Relevant tests pass. If exact-version environment cannot be recovered safely, record the blocker and stop the benchmark phase.

## 2. Run and review the performance gate

Build a reusable benchmark runner around `launch-exact.ts`, `wait-renderer.ts`, `cache-status.ts`, `fill-cache.ts` and `capture-fixture.ts`, adapting only after reading their contracts.

- Add deterministic assertions for renderer readiness, isolated cache/profile ownership, initial cache state, requested fileId and actual selected playback fileId.
- Run at least three alternating cold/warm same-file pairs. Include canonical decoded output checks and exact Ogg fixture comparisons where applicable.
- Run at least three paired fixed-batch trials with speculative prefetch overlapping normal sequential extraction. Use a benchmark-only controller first; production queue changes are unnecessary to establish this gate.
- Exercise the proposed handoff (cancel/destroy speculative handle before capture), two-slot resource limit, cancellation and buffering observations.
- Store machine-readable per-trial timings/counters and a concise results table. Include setup, acquisition, extraction and total batch timing separately. Log invalid trials and reasons.
- Apply the spec's proposed 10% median batch improvement threshold and correctness/resource criteria. Record GO, NO-GO or INCONCLUSIVE with evidence. Restore the user's daemon and verify IPC/HTTP/process health after trials.

Exit: GO permits phase 3. NO-GO ends with documentation and no production prefetch. INCONCLUSIVE requires a bounded additional measurement or explicit blocker, not implementation on optimism.

## 3. Implement one shared renderer acquisition adapter

Suggested new module: `src/core/spotify-prefetch.ts`; reuse/refactor narrowly from `spotify-renderer-auth.ts` and existing renderer-service code. Keep service/schema implementation authoritative in one place.

Proposed typed boundary:

```ts
interface PrefetchVariant {
  trackUri: string;
  fileId: string;
  formatEnum: number;
  bitrate: number;
}
// Runtime binding carries the exact owned renderer/profile generation.
// Resolve, cache-check and prefetch accept AbortSignal and bounded deadlines.
// Progress carries counters/status only, never payload bytes or signed URLs.
```

- Confirm schema fields, integer/range semantics and service discovery against preserved descriptors and probes before coding the adapter.
- Add variant selection based on verified session quality policy; return an explicit skip when unknown.
- Keep auth and resolved URLs ephemeral, validate returned file identity, and retain existing loopback/auth boundaries.
- Process bounded chunks inside the renderer, enforce full-range coverage and stable size, check final/cache confirmation and destroy handles on every exit.
- Add generation guards for late responses and disconnects. Cleanup uncertainty disables new speculative work.
- Record exact-build prefetch support separately in the existing compatibility machinery without widening the capture whitelist. Default off and reject unsupported enabled configurations explicitly.

Tests before integration: parser/range gaps and overlaps, integer limits, protocol errors, cache hits, eviction, expired resolution, malformed responses, timeouts, cancellation before/after handle creation, disconnect during cleanup and late callbacks. Ensure no sensitive data or media is logged. Verify bounded response handling with many chunks rather than a single tiny mock.

## 4. Integrate bounded lookahead into the existing scheduler

Primary locations: `webapp/src/server/pool.ts`, `priority-queue.ts`, `spotify-instance.ts`, `runtime-config.ts`; add a small controller module only if it keeps pool logic clearer.

- Provide a read-only ordered queue snapshot rather than a second queue implementation.
- Bind one controller to the daemon-owned instance and its generation; do not enable the first increment in standalone multi-instance web mode.
- Add two-slot/two-variant lookahead, variant deduplication and job consumer tracking. Extraction remains driven exclusively by the existing dispatch/downloadJob path.
- Wire enqueue, cancellation, priority, assignment, retries, shutdown and recycle to reconcile or invalidate prefetch.
- Hand off speculative work before playback; never wait for a file to become cached. Preserve the existing shared CLI/web scheduler and exact returned-job binding.
- Detect selected-file mismatch and pressure, record the missed optimization, and suppress speculation as specified. Do not reinterpret a validated capture as failed solely because prefetch missed.
- Read `SOGGFY_PREFETCH` strictly, default disabled; no user-facing concurrency knob in this increment.

Tests: two acquisitions plus exactly one extraction; queued cancellation destroys only the appropriate handle; deduplicated consumers; priority job bypasses cache readiness; no duplicate capture on simultaneous CLI/web submissions; retries/recycle invalidate stale handles; opt-out scheduling matches baseline. Add failing regressions before repairs to existing behavior.

## 5. Expose truthful status and document scope

Primary locations: `webapp/src/server/jobs.ts`, existing job serialization/UI components, `README.md`, `docs/cli/download.md`, configuration docs discovered in the checkout.

- Add optional prefetch metadata with bounded error codes and counters. Keep all existing export state transitions and bytesCaptured semantics.
- Render a small queued-job status without suggesting protected cached bytes are playable downloads.
- Document enable/disable, exact supported build/runtime scope, measured results, disclosed fallback and sequential extraction.
- Correct the broad claim that a web instance pool alone guarantees parallel exports; note fixed playback-control/account constraints where relevant.
- Explicitly state that standalone and one-at-a-time CLI batches are not accelerated by this increment. Do not invent a CLI concurrency flag.

Tests: API status remains backward compatible; queued cached jobs are not completed; final output URLs appear only under existing completion rules; warnings/errors do not contaminate CLI stdout; UI status is understandable and manually inspected.

## 6. Verify, review and prepare handover

Run repository checks appropriate to the actual changed files, then the integrated release gates:

```sh
bun test
bun run typecheck
bun run typecheck:webapp
bun run test:native
bun run build:payload
bun run build:release
bun run docs:build
git diff --check
```

Run the web production build if it is not already covered by the release runtime build. Inspect package scripts rather than assuming duplicated build steps are needed. Native checks are required if investigation instrumentation remains in the deliverable. Monitor free disk space before generated runtime builds.

Repeat the exact-build live batch gate after integration. Exercise cancel, priority, renderer loss and daemon restart. Confirm the restored normal environment remains healthy. Tests that pass with mocks cannot substitute for these live checks.

Review against all six spec criteria. Fix concrete failures, rerun affected checks and record remaining limits. Update HANDOVER.md with GO/NO-GO, actual support, commands, measured results and next actions. Review the final diff so only intended documents/investigation/feature changes enter any later commit; do not stage unrelated work.

## Optional later work, not part of this plan

- CLI batch lookahead using the same adapter/controller with explicit batch ownership, bounded submission, ordered output and cancellation of outstanding jobs on CLI failure/disconnect.
- Parallel native extraction only after a new processing entry point passes independent identity, full-output and cancellation experiments.
- Wider build support, default-on rollout or configurable concurrency only after additional compatibility/performance evidence.

## Completion record

Gate B passed with a 60.043% median fixed-batch improvement and 3/3 improved pairs. Phases 3–5 are implemented. Phase 6 live acceptance verified exact canonical output hashes, two-slot lookahead, exact-variant 16x handoff, cancellation, priority interruption/requeue, daemon restart, and fail-closed renderer loss. `SOGGFY_PREFETCH` remains disabled by default and registry-supported only for exact 1.3.0.277.
