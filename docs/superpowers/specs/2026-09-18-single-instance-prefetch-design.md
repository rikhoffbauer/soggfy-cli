# Single-instance parallel prefetch with sequential extraction

Status: proposed; production implementation is conditional on the performance gate below.
Date: 2026-09-18.
Companion: [implementation plan](../plans/2026-09-18-single-instance-prefetch.md).

## Goal and evaluation rubric

Improve batch export throughput using one authenticated, patched Spotify process by fetching upcoming exact audio variants concurrently while retaining the existing sequential extraction path. This does not deliver simultaneous extraction or simultaneous playable-song completion.

Evaluate the result against six criteria:

1. Correct identity: requested/relinked track, selected variant and validated output agree.
2. Measurable benefit: controlled batch benchmarks satisfy the performance gate.
3. Lifecycle safety: cancellation, priority, restart and cleanup preserve single-owner capture.
4. Bounded resources: at most two speculative acquisitions and a small lookahead window.
5. Honest behavior: cache progress is separate from export completion; failures are explicit.
6. Reproducibility: exact build, probes, results, tests and operational restoration are recorded.

## Evidence and its limits

The user-supplied investigation reports the following on Spotify 1.3.0.277 arm64. Probe/schema/fixture artifacts are present in `investigations/spotify-1.3.0.277-streamer/`; this specification author checked their presence and relevant source interfaces, but did not rerun the live experiments.

- Independent progressive Download streamers fetched distinct files concurrently, without replacing main-player playback, including when offlineEnabled was false.
- Returned bytes are not decodable Ogg. Full cache rereads matched acquired protected-byte hashes.
- Cancelling RequestData alone did not stop underlying acquisition. Cancelling and promptly destroying the streamer prevented completion in the tested case without disrupting another streamer.
- Download.IsFileFullyCached and delivery accounting reflected this path; Storage.GetFileRanges did not.
- Standalone Harmony/browser audio players did not enter the native protected-Ogg pipeline. The shipped preview configuration disallows protected tracks and does not supply an alternative native Ogg player.
- Investigation instrumentation separated native streams by decoder pointer, Ogg-state pointer and serial. Two fixture dumps matched existing validated captures byte-for-byte. That is evidence for those fixtures, not a general production file-ID association mechanism.
- No usable cold/prefetched benchmark is yet established. The first attempted trial failed renderer readiness and must not be counted.

These findings justify investigating prefetch, not claiming fully parallel export or universal compatibility. The reported official arm64 executable SHA-256 is `7bc5fd4668e80f7066bcf31fa11489c4cbb620519e3424fd3c56482c8bc62415`; the earlier patched derivative is `afee5739f9074f727970a843962a44d05bd323b0a1b1fedd2df4eb601830f258`. Rebuilt patched copies may differ. Record the actually tested image and registry entry for every run.

## Scope and non-goals

Initial production scope, only after the gate passes: opt-in prefetch for already queued jobs in the daemon-backed web/API scheduler, using its one Spotify instance. No second process or account, offline-download queue, independent decryption implementation, native decoder redesign, quality override, or concurrent playback capture.

Standalone CLI downloads and the CLI's sequential batch submission remain behaviorally unchanged in this increment. They can benefit incidentally from cache warmed by queued daemon jobs, but no CLI playlist speedup is promised. CLI batch lookahead is a separate follow-up requiring explicit submission, cancellation and output-order semantics; do not silently submit an entire playlist merely to expose future tracks.

Do not redesign encoding concurrency as part of this change. Preserve existing validated output publication and binary-safe stdout.

## Decision gates

### Gate A: evidence and operational readiness

Normalize/document the preserved probes, review investigation-only native instrumentation, verify renderer service readiness, and identify actual owned daemon/probe processes. Record the current process state rather than trusting old PIDs. Use isolated profiles and exact supported binaries. Never kill by broad process-name matching. Restore the user's normal daemon after experiments and verify IPC, HTTP health and owned Spotify process health.

### Gate B: correctness and usefulness

Run at least three valid paired cold/prefetched trials on the same track and exact file ID, then at least three paired fixed multi-track batch trials with prefetch disabled/enabled. Alternate trial order. Use fresh cache-isolated profiles with identical login/configuration, verify initial cache state, renderer readiness and selected playback file ID, and record any warmup/setup separately. A readiness failure, variant mismatch or invalid output invalidates that comparison and is reported rather than discarded silently.

Measure cold extraction, prefetch time, warm extraction, network/cache bytes, total batch time from first submission to last validated output, per-track completion, retries and buffering. Include prefetch startup cost in enabled batch totals; warm extraction alone is not the success metric. Validate container, duration and decodeability for every output and compare exact Ogg/PCM fixtures where applicable.

Proposed engineering acceptance threshold: at least 10% lower median total batch time, improvement in each of the three paired batch runs, no invalid/misattributed output, and no additional observed capture failures or buffering stalls. This threshold is a design choice, not a measured result. Borderline/noisy results leave the feature off and require more evidence; do not claim significance from three runs. If the gate fails, publish findings and stop production implementation. A documented no-go is a completed investigation outcome.

## Architecture

```text
Existing priority job queue (authoritative ordering and job ownership)
             |                            |
             |                    next two eligible queued jobs
             |                            |
             |                  per-instance prefetch controller
             |                       /              \
             |                 streamer A       streamer B
             |                       \              /
             |                      Spotify-managed cache
             v                            |
Existing single capture worker <----------+
             |
Native EOS -> existing validation -> encoding/tagging -> output
```

A shared core adapter owns private renderer service discovery, track/variant resolution, storage resolution and Download RPC encoding/decoding. Reuse existing renderer-auth/CDP primitives where suitable. Do not copy probe-specific React traversal or protobuf parsers into several callers. The controller belongs to the exact Spotify instance/profile/runtime generation; cache from another profile cannot satisfy it.

The controller observes an immutable ordered snapshot of the existing queue. It does not dequeue, promote, finish or create jobs. Extraction never waits for speculative readiness. When a job becomes the active capture, stop its speculative request and destroy its handle before issuing playback; cache readiness is advisory and eviction is allowed. Verify in the benchmark that this handoff preserves the benefit.

### Identity and variant policy

Use resolved playable URI, formatEnum and exact fileId. Deduplicate work by instance generation and exact variant, with job consumers tracked separately. Never infer identity from cache filenames, Ogg serial alone or thread ID.

Prefetch only the variant matching a verified playback-quality selection policy for this build/session. Do not equate format enumeration with selection, hardcode 160 kb/s for every account, or prefetch every variant. If selection cannot be predicted reliably, skip with an explicit reason. Observe actual playback fileId during capture; mismatch means the optimization missed, not that a valid existing capture must fail. Repeated mismatch disables prefetch for that session and is surfaced diagnostically. Quality/auth/runtime changes invalidate predictions and speculative state.

### Completion and lifecycle

Internal acquisition states: pending, resolving, fetching, cached, skipped, failed, cancelled. They are subordinate metadata, not replacements for DownloadState. A queued export may be cached without being assigned or completed.

For a newly fetched file require successful protocol completion, stable known total size, exact union of returned byte ranges covering the requested full object, and IsFileFullyCached confirmation. Determine range-end semantics from the preserved protocol/probes and test them explicitly. Overlap must not double-count bytes; reject gaps, inconsistent totals, out-of-range positions and error responses. An existing cache hit can be recorded after IsFileFullyCached without rereading the whole file; it remains only a cache hint.

Keep protected payloads inside Spotify where possible; consume/discard bounded response chunks in the renderer and send only counters/status to Bun. Never accumulate whole songs as JSON byte arrays. Spotify retains cache ownership; cancellation does not delete shared cache entries or promise to retract bytes already fetched.

All exits destroy handles in bounded cleanup: success, error, timeout, cancellation, reprioritization, renderer disconnect and shutdown. Cancel delivery before destruction; tolerate late callbacks using generation/attempt tokens. Deduplicated acquisitions remain alive until their last interested queued job leaves. If destruction cannot be confirmed, disable new prefetch for that instance, report cleanup uncertainty and let normal controlled recycle/shutdown resolve it; do not restart active capture just to recover an optional optimization.

### Scheduling and limits

Start with at most two speculative streams and the next two distinct eligible queued variants. The existing capture worker remains singular and authoritative. Recompute on enqueue, cancel, priority change, assignment and terminal transitions. A priority job is never delayed behind prefetch. Expelled speculative jobs release their handles before replacement work starts.

Initial internal limits: 10 seconds for renderer/service/resolve setup, 15 seconds without delivered progress, 60 seconds total per acquisition, and 5 seconds for cleanup. These are conservative proposed defaults to verify against fixtures/live tests. No automatic prefetch retries in the first increment; the existing extraction path still performs its established retries. Bound delivery requests to 64 KiB ranges, subject to confirming protocol semantics. The lookahead limits speculative files, not total Spotify cache size. Disk/cache errors stop prefetch and remain visible.

If current capture reports buffering/stall pressure, cancel speculation and suppress it for the remainder of that capture. Do not treat merely unchanged UI position as sufficient evidence without the existing playback monitor. If the runtime cannot safely observe pressure, default off until live resource tests establish acceptable behavior.

## Configuration and observable behavior

Proposed flag: `SOGGFY_PREFETCH=0|1`, default 0. Invalid values are explicit configuration errors. Enabled configuration on an unvalidated build or unsupported runtime mode produces a clear unsupported-prefetch error; normal operation with the flag off remains available. Validate prefetch capability separately from existing Ogg-hook compatibility: support for capture on another version is not evidence for these private services.

A runtime acquisition failure marks that prefetch failed/skipped with a bounded reason and allows the normal capture path to proceed. This is a disclosed optimization fallback, not silent media success. Do not expose signed URLs, credentials, cookies, tokens, raw media or streamer handles in logs/API responses.

Expose optional job prefetch status/counters and a concise UI indication such as “Prefetching” or “Cached; waiting to capture.” bytesCaptured and playable output progress retain their existing meanings. No new public endpoint is needed: use existing authenticated/protected job/status routes. Disabling the flag restores the original scheduling path without cache migration.

## Verification and release conditions

Automated coverage must exercise identity/variant mismatch, cache eviction, exact range coverage, late callbacks, bounded memory/progress, timeout cleanup, deduplication, queue priority, cancellation, session invalidation and concurrent CLI/web job ownership. Validate the opt-out path and assert only one capture can run while two prefetches are active.

Live acceptance requires the exact-version benchmark plus queue cancellation, priority playback and daemon restart with prefetch enabled. Unit tests or mocked renderer RPCs do not establish live compatibility. Keep experimental native instrumentation opt-in and review its lifecycle/resource behavior independently; production prefetch must not require it.

If evidence supports shipping, retain default-off for the initial release, update user documentation with measured scope and limits, and record exact checks/results in HANDOVER.md. Future fully parallel extraction is a separately scoped research project.
