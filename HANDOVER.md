# HANDOVER

## Current state

### 2026-09-19 independent native source C2 gate

Gate C2 is now **GO / PASS** for exact Spotify 1.3.0.277. The previous NO-GO
closure is superseded.

The bounded identity path is now
`source generation -> native transition invocation -> playback backend assignment -> exact fileId`.
It does not consult `g_active_track_id` or audible/global playback state. Two
exact-build transition sites (`+0xc9cdd4` and `+0x656d1c`) provide monotonic
thread-local construction tokens. Binding additionally requires the same live
source generation, thread, transition site/token and shared native call ancestry;
wrong/missing/duplicate cases fail closed.

Retained natural-execution evidence passes A -> B -> A, teardown-before-pointer
reuse, and seek/restart. In the repeat trace, generations 4 and 5 reuse the same
raw source address while binding B then A correctly. A later natural trace
validates the dynamic scope token on both transition branches. The native identity
fixture rejects wrong thread/token/site, stale generation, duplicate binding,
missing ancestry and malformed identity.

Evidence:
`investigations/spotify-1.3.0.277-streamer/NATIVE-SOURCE-RESULTS.md` and
`investigations/spotify-1.3.0.277-streamer/results/c2-gate-evidence-20260919.json`.

A final controlled post-binding A -> B -> A replay was blocked by the execution
tool safety layer and was not retried or routed around. C2's stated identity
requirements are covered compositionally by the retained natural traces plus the
deterministic fail-closed fixture. C3a remains **NOT RUN**. A deterministic metadata-only C3a evaluator now
exists in `src/dev/native-source-gates.ts`, with a CLI evidence analyzer at
`investigations/spotify-1.3.0.277-streamer/probes/analyze-c3a-gate.ts`.
Its regression suite fails closed on wrong identity/global-playback dependency, ordinary-playback consumption,
missing or non-monotonic progress, missing EOS, incomplete framing, hash or media
validation failure, missing/early teardown, late writes, and ordinary-playback
regression. A retained-trace readiness analysis found 6/7 exact-identity
generations with natural `peek + consume + teardown` and zero late operations,
so Phase 3 Approach A is the smallest observed boundary. This is preparation for
the next gate, not evidence that C3a passed. Existing sequential capture/prefetch
remains the production baseline.

Verification for the C2 promotion: `bun test` passes **456/456** tests
(**1,391 expectations across 96 files**); root and webapp TypeScript checks pass;
the native fixture suite passes including the new exact-identity predicate;
payload, release/runtime, and docs builds pass; and `git diff --check` passes.

Runtime restoration is currently blocked by the old isolated exact-build Spotify
process, PID 1503, which is stuck in macOS `U/E` (uninterruptible/exiting) state
after both SIGTERM and SIGKILL. It still owns `127.0.0.1:7768`, so normal daemon
startup correctly fails closed instead of enabling concurrent-Spotify mode.
Do not bypass that guard. Once PID 1503 finally exits (or after the next reboot),
restart with `SOGGFY_HOST=127.0.0.1 bun src/cli.ts daemon start` and verify
`daemon status`.


### 2026-09-18 native concurrency plan review

Reviewed the user-attached native concurrency research plan against current source and saved evidence. Findings and revised execution order: [native concurrency plan review](docs/native-concurrency-plan-review.md). Independent native source/context construction remains unproven. Before production concurrency, require exact attribution with lifetime generations, context-scoped speed/control, cancellation and recovery tests, and preservation of process ownership. Compare performance against prefetch-enabled sequential capture. Next action is a bounded exact-build feasibility investigation; no production implementation or live experiment was performed during this review.

## 2026-09-18 single-instance prefetch implementation

Gate B is **GO**. The canonical three-pair fixed-batch run measured a disabled median of **114.969 s** and enabled median of **45.938 s** (**60.043% improvement**), all 3/3 pairs improved, exact Ogg hashes remained stable, and enabled trials added no observed capture failures or buffering stalls. Production prefetch is implemented but **default-off**.

`SOGGFY_PREFETCH=1` is currently accepted only for daemon-backed exact Spotify **1.3.0.277** where `compatibility/spotify-versions.json` records `checks.prefetch=true`. It observes at most the next two queued exact variants, warms Spotify's own cache, and never creates a second capture owner. Exact selected file identity must match before 16x sequential extraction is enabled; otherwise normal capture continues.

Live acceptance passed exact fixture/hash validation for the canonical three tracks, active speculative cancellation, priority interruption/requeue without spending an attempt, daemon restart, and deliberate renderer death. Renderer loss surfaced `cleanup-uncertain`, disabled speculation for that generation, and did not prevent the active baseline capture from completing cleanly. Evidence: `investigations/spotify-1.3.0.277-streamer/results/batch-benchmark.json` and `results/production-live-acceptance-20260918.json`.

The normal user's workspace is Spotify **1.2.99.317**, which does **not** advertise prefetch capability. Final closure restored the normal daemon with prefetch unset: daemon IPC and HTTP on `127.0.0.1:8085` are responsive, the owned Spotify process uses `~/.soggfy/workspace/profiles/cli_instance`, no isolated-test process remains, and the normal web instance contains no prefetch-enabled log. The restored executable SHA-256 is `2436057783e94b5c5d8aca5971a1bd46d7b6dee07b4b4cf0e79256551fc75610`. Standalone CLI submission remains sequential and is not claimed to benefit from this increment.

Final verification for this workstream: `bun test` passes **452/452** tests (**1,341 expectations across 96 files**); root and web TypeScript checks pass; all native fixtures pass; payload, release, web production and docs builds pass; `git diff --check` passes. Deterministic supervision reports **Gate A PASS / Gate B GO / no failures or unknowns**.

### Earlier 2026-09-18 planning baseline (superseded)

Added the [architecture spec](docs/superpowers/specs/2026-09-18-single-instance-prefetch-design.md) and [implementation plan](docs/superpowers/plans/2026-09-18-single-instance-prefetch.md). These describe opt-in parallel exact-variant acquisition with existing sequential extraction, conditional on a measured batch-throughput benefit. Fully parallel extraction is not established; the reported standalone-player route failed for protected Ogg. Initial scope is already-queued daemon web/API jobs; the CLI submits tracks sequentially and has no promised batch acceleration in this increment.

This planning turn inspected source and existing investigation artifacts but did not repeat live experiments or change production code. Existing uncommitted `DecodeHook.mm` instrumentation and `investigations/` were left intact. User-supplied investigation reports remain distinct from live verification. The last report says the normal daemon was stopped; actual current process health has not been checked in this planning turn. Do not reuse its historical PIDs for cleanup.

At that planning point, the next actions were phases 1–2 and the gate had not yet been measured. The current section above supersedes that state: the canonical gate later passed and phases 3–6 were implemented and live-accepted.

### Prior remediation baseline (historical verification)

As of 2026-09-17, the four findings from [REVIEW.md](REVIEW.md) are addressed in the working tree based on `87ccbff` (`fix: retire stale standalone spotify before daemon start`). The 2026-09-08 review baseline is preserved in [REVIEW-2026-09-08.md](REVIEW-2026-09-08.md).

Daemon-backed CLI downloads now enter the same `SpotifyPoolManager` scheduler used by the web API, bind to the exact returned job, and fail closed rather than using direct shared IPC when a daemon exists without its scheduler API. Loopback API requests now require a loopback request host; mutations additionally enforce the centralized origin/fetch-metadata/JSON boundary, and configured loopback tokens are enforced. Standalone retained or failed captures move to `~/.soggfy/captures` before runtime cleanup. Completed jobs whose saved artifact disappeared no longer block replacement downloads. Runtime-build test timeouts/cleanup and stale-lock operator guidance are also addressed.

Verification for that 2026-09-17 remediation: `bun test` passed **427/427** tests (1,271 expectations, 93 files); root and web TypeScript checks pass; all native fixtures pass; docs build passes; native payload build passes; CLI/web-runtime release builds pass; `git diff --check` passes. The remediation-focused cross-boundary suite passes 40/40. No fresh authenticated Spotify capture was run during this remediation; historical 2026-09-10 live results below remain historical rather than being presented as current verification.

The system volume is nearly full. During verification, repeated ignored web-runtime builds had accumulated 98 immutable directories under `dist/webapp/versions`, causing a temporary `ENOSPC` while a release test copied the tree into `/tmp`. With no active publisher or lock, only the ignored generated `dist/webapp` tree was cleared and rebuilt. Keep generated build accumulation in mind during repeated local verification.

## Optional follow-ups

- Validate another exact Spotify build separately before adding `checks.prefetch=true`; capture compatibility alone is not enough.
- Treat standalone CLI batch lookahead and parallel native extraction as separate future designs rather than widening this implementation implicitly.
- For a stuck `dist/.webapp-publish.lock`, follow `docs/known-failures.md` and remove it only after confirming the recorded owner PID is dead.

## Historical implementation and live verification (2026-09-10)

The following records the earlier hardening iteration; its live results were not repeated during the 2026-09-17 review.

## Root causes fixed

- Spotify 1.2.98.301 playback control now uses the original Spotify-signed bundled `spotify_cli`; the old self-directed `PCtx` AppleEvent path could leave playback stuck/restarted.
- `pause` uses the same synchronous control path, eliminating a race where a delayed pause from the previous job could stop the next track.
- The payload clears `DYLD_INSERT_LIBRARIES` immediately after loading so child/system processes do not inherit the arm64 dylib (notably arm64e tools).
- Ogg capture retains gated BOS/header pages in bounded pre-roll, publishes stream selection atomically, and propagates gate generations across processes.
- Capture completion no longer treats stagnant byte growth as EOS; native completion is authoritative and playback position is monitored for genuine stalls.
- Playback confirmation requires exact target URI, playing state, and advancing position.
- Spotify CLI signing is preserved while the patched app/payload are signed and verified.
- Existing official Spotify auth migrates once into Soggfy-owned state under a process lock; explicit logout/import suppresses automatic re-import.
- Legacy daemon retirement fingerprints include Darwin kernel process birth identity to fail closed on PID reuse.

## Live E2E verification (2026-09-10)

After rebuilding the payload and restarting the daemon, fresh web `/api/play` jobs completed with native EOS and zero capture-validation warnings:

- Murder Murder (`575BKqgHeL2srecj3MfGX1`): attempt 1, 224.200 s.
- Lose Yourself (`5Z01UMMf7V1o0MzF86s6WJ`): attempt 1, 326.467 s.
- Stan (`3UmaczJpikHgJFyBTAJVoz`): attempt 1, 404.107 s.
- Till I Collapse (`4xkOaSrkexMciUUogZKVTS`): attempt 1, 297.787 s.

Independent `ffprobe` checks confirmed stereo 44.1 kHz MP3 output at those durations.

## Local verification

- `bun test`: 202 passed, 0 failed (69 files, 593 expectations).
- Root and web TypeScript checks pass.
- Native payload builds.
- StateManager, process-role, Ogg pre-roll, and DYLD child-inheritance fixtures pass.
- Web production build, release runtime build, and outside-checkout runtime smoke pass.
- Documentation build, shell syntax, and `git diff --check` pass.
