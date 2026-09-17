# Repository review — 2026-09-17

Reviewed working tree at `87ccbff` (`fix: retire stale standalone spotify before daemon start`). This document began as the 2026-09-17 assessment; the findings below were subsequently remediated in the same working session and are retained with their original evidence for traceability.

The earlier review and its remediation checkpoints are preserved in [REVIEW-2026-09-08.md](REVIEW-2026-09-08.md). Its resolved findings are historical, not additional current defects.

## Resolution status — 2026-09-17

| Finding | Status | Resolution |
|---|---|---|
| P1 — CLI captures bypass daemon scheduler | **Fixed** | Daemon-backed CLI downloads submit a direct `trackId` to `/api/download`, bind to the exact returned job ID, and poll that scheduler job to a validated saved artifact. If daemon IPC is alive but its scheduler API is unavailable, the CLI fails closed instead of issuing direct capture IPC. |
| P1 — loopback API accepts foreign-origin mutations | **Fixed** | The common API wrapper now enforces loopback request-host policy, same-origin/absent browser `Origin`, rejects opaque/cross-site mutations, requires `application/json`, and honors an explicitly configured token on loopback. Origin-less native clients remain supported. |
| P2 — temporary cleanup deletes retained captures | **Fixed** | Standalone retained/failed media is moved to owner-only `~/.soggfy/captures` before temporary runtime deletion. Lifecycle tests cover normal cleanup, `--keep-wav`, transcode failure, capture-validation failure, and instance-start failure. |
| P2 — missing completed artifact blocks re-download | **Fixed** | Completed jobs are reusable only while their `savedPath` still exists; a missing artifact invalidates track reuse so a replacement job can queue normally. |
| Build-test timeout/stale-lock follow-up | **Fixed / documented** | Runtime-build tests have realistic explicit timeouts, spawned publishers are bounded, slow cleanup has an explicit hook timeout, and safe fail-closed stale-lock diagnosis/recovery is documented. |

## Scope and assessment criteria

Inspected CLI capture/output lifecycle, shared daemon ownership, native IPC dispatch, web queue/state/output handling, API authorization, build publication, documentation, and existing tests. Criteria: capture correctness; concurrency and ownership; retention/recovery; HTTP trust boundaries; useful regression coverage; reproducible builds and handover. Vendored reference implementations were not comprehensively audited. Live Spotify capture, credentials, injection, signing and browser playback were not exercised.

The strongest existing safeguards are exact version/prologue checks, native writer ownership, media validation and process fingerprint checks. The original findings below crossed those component boundaries; their pre-fix evidence is retained alongside the implemented resolutions.

## Findings

### 1. P1 — CLI captures bypass the daemon's job scheduler — FIXED

**Resolution:** `src/core/daemon-capture.ts` discovers the daemon's published HTTP origin, submits the track through `/api/download`, follows the exact returned scheduler job ID, and consumes only its completed saved artifact. `downloadCommand` uses this path whenever the daemon scheduler is healthy and refuses direct shared IPC when daemon IPC exists without the scheduler. Direct URL/playlist web submissions retain their existing asynchronous queue semantics. Cross-boundary fixtures verify two CLI-backed jobs plus one web job serialize at concurrency one and that terminal failure releases ownership.

**Evidence:** `src/commands/download.ts:169-180,208` selects the shared daemon socket after a ping and calls `captureTrack` directly. `src/core/capture.ts:46-52` immediately issues `reset_track`, `set_track` and playback commands. The web daemon uses the same socket/save directory in `webapp/src/server/spotify-instance.ts:94-97`; only web jobs participate in `SpotifyPoolManager` scheduling. Native `soggfy-macos/Payload/Main.mm:626-633,684-689` accepts those state-changing commands without a caller-owned capture lease.

**Impact:** a CLI download started while a web job is capturing, or two simultaneous daemon-backed CLI downloads, can change the active track underneath the other caller. Their subsequent pause/reset/finalization commands can disrupt each other. Native single-writer election prevents duplicate writer processes; it does not serialize independent capture requests.

**Best fix:** make the daemon scheduler the sole owner of captures. Submit CLI requests as daemon jobs, await that job's validated result and copy/transcode it to the requested CLI destination. Keep temporary standalone capture only for the explicit standalone path. If retaining direct IPC temporarily, introduce one cross-process lease covering the whole capture lifecycle and require both CLI and web paths to use it; a process-local mutex is insufficient.

**Validation:** add an offline integration fixture with a recording fake playback/IPC backend. Start two CLI requests plus a web job and assert that each track's reset/play/finalize sequence is serialized, failures release ownership, and one client cannot pause or delete another client's capture. Then repeat with two real tracks on a supported Spotify build. This review traced the concrete conflicting call paths; it did not intentionally interrupt live captures.

### 2. P1 — Loopback API mutations accept foreign-origin requests — FIXED

**Resolution:** mutation protection is centralized in `protectApiRoutes`. Loopback mode rejects non-loopback request hosts, foreign/opaque origins and cross-site fetch metadata, requires JSON content type, and honors a configured loopback token. Same-origin browser requests and origin-less native clients remain valid; existing remote bearer/session behavior is retained.

**Evidence:** `webapp/src/server/security.ts:14-18` disables authorization for every loopback bind, including when a token is configured. The wrapper at `:89-102` checks neither request origin nor fetch metadata. Mutations such as `webapp/src/server/routes.ts:186-193` call `req.json()` without requiring JSON content type.

**Reproduction:** invoked the actual `protectApiRoutes` wrapper with loopback security and a harmless sentinel POST handler, supplying `Origin: https://untrusted.example`, `Content-Type: text/plain`, and JSON text. Result: `{"status":200,"mutated":true}`. No Spotify action was performed. Browser-specific local-network restrictions were not tested, so this establishes the server-side gap, not a verified exploit in every browser.

**Impact:** any foreign-origin request that reaches the local server can trigger playback, queueing or cancellation. Omitting CORS response headers does not make a received mutation safe. The default loopback service needs to distinguish the app's own browser requests from unrelated sites.

**Best fix:** centrally reject foreign or opaque browser origins for mutation routes, validate expected Host/origin policy, and require `application/json` for JSON mutations. Preserve origin-less native clients under an explicit policy. Honor an explicitly configured API token even on loopback. Apply protection once in the common wrapper.

**Validation:** test foreign, `null`, valid same-origin and absent Origin cases, JSON versus plain-text bodies, configured loopback tokens, and current remote bearer/session behavior. Add a browser check confirming that an unrelated page cannot trigger a sentinel action.

### 3. P2 — Temporary downloads delete captures promised to be retained — FIXED

**Resolution:** standalone retained media is moved out of the ephemeral Spotify tree into `~/.soggfy/captures` with private permissions before the runtime tree is removed. `createDownloadCommand` provides a narrow external-operation seam so the actual command lifecycle is tested with real temporary filesystem state for success cleanup, `--keep-wav`, transcode failure, capture-validation failure and instance-start failure.

**Evidence:** `src/commands/download.ts:184-197` puts standalone captures under `tempRoot/save`. The per-file cleanup at `:240-243` honors `--keep-wav` and preserves a capture when output processing fails, but `:246-250` unconditionally removes the entire temporary root. `test/download-cleanup.test.ts` only tests the boolean helper, not the enclosing cleanup.

**Impact:** `download --no-daemon --keep-wav ...` loses its intermediate capture. The same occurs when no daemon is available. A failed transcode or failed validation can also destroy the sole capture despite the preservation intent/error message, making diagnosis or retry require a fresh download.

**Best fix:** before deleting temporary runtime files, move retained/failed captures into an owner-only persistent capture directory and print the resulting path to stderr. Separate runtime cleanup from media retention, and put startup cleanup under the same lifecycle guard. Do not retain the entire Spotify temporary profile merely to retain one media file.

**Validation:** exercise `downloadCommand` with injected instance/capture/output operations and a real temporary filesystem. Cover successful cleanup, successful `--keep-wav`, transcode failure, capture validation failure and instance-start failure. Assert file existence after the command returns or throws; testing only a helper predicate misses this bug.

### 4. P2 — A completed job with a deleted output blocks normal re-download — FIXED

**Resolution:** `JobRegistry.findReusable` now treats a completed job as reusable only when `savedPath` exists. Missing completed artifacts remove the stale track reuse mapping, allowing `SpotifyPoolManager` to create a replacement queued job while preserving normal deduplication for active and intact completed jobs.

**Evidence:** `webapp/src/server/jobs.ts:165-169` treats every completed job as reusable without checking its artifact. `webapp/src/server/pool.ts:54-64` returns it before enqueueing. `/api/download` uses `addJob`, and playlist queue-all similarly counts it as existing. The separate `playNow` path does perform an output check, so behavior differs by entry point.

**Reproduction:** created a completed job whose `savedPath` points to a nonexistent temporary file and called the actual `new SpotifyPoolManager(0).addResolvedJob(trackId)`. Result: `{"returnedSameJob":true,"state":"completed","queued":[]}`. No network or Spotify process was needed.

**Impact:** deleting or moving a downloaded file while the daemon is running leaves API download/playlist queue requests reporting reuse instead of producing a replacement. The file route then returns unavailable output, and retry only accepts failed/cancelled jobs.

**Best fix:** centralize reusable-job eligibility: active jobs are reusable; completed jobs are reusable only when a usable saved artifact exists. When a completed artifact disappears, create a replacement job (or explicitly invalidate the old completion) consistently across play, download and collection queueing.

**Validation:** complete a fixture job, remove its output, then exercise each enqueue path and verify a replacement is queued. Also cover intact completed outputs, active duplicates and failed jobs so deduplication remains correct.

## Verification after remediation

- `bun test`: **427 passed, 0 failed**, 1,271 expectations across 93 files.
- Remediation-focused suite: **40 passed, 0 failed**, including daemon job binding, shared scheduler serialization/failure release, mutation boundary policy, missing-artifact replacement, full standalone download lifecycle, and both runtime-build integration tests.
- `bun run typecheck` and `bun run typecheck:webapp`: passed.
- Native fixtures passed: state manager, process role, Ogg pre-roll, exact hook targets, and child-process DYLD inheritance.
- `bun run docs:build`: passed after moving aside an old root-owned generated VitePress `dist` tree and rebuilding it as the current user.
- Native payload build (`cmake -B soggfy-macos/build -S soggfy-macos && cmake --build soggfy-macos/build`): passed.
- Release builds (`bun run build:cli` and `bun run build:web-runtime`): passed.
- `git diff --check`: passed.
- The generated `dist/webapp/versions` tree had accumulated 98 ignored build versions during repeated verification and caused an `ENOSPC` copy failure against the nearly-full system `/tmp`; no publisher/lock was active, so the ignored generated web runtime was removed and rebuilt fresh before rerunning the affected suite. This was verification-environment cleanup, not a source-code workaround.

Fresh authenticated Spotify capture was not performed as part of this remediation. Historical supported-version live captures remain documented separately; a fresh live smoke is still appropriate before a release that changes the native capture/runtime stack.

## Remaining release validation

1. On a supported Spotify build, run a fresh daemon-backed CLI capture and web capture to confirm the scheduler path against the real runtime.
2. If release confidence requires it, exercise simultaneous CLI/web submissions and verify queue order plus final media independently with `ffprobe`/whole-track fixtures.
3. Keep the fail-closed web-runtime publish-lock recovery procedure in `docs/known-failures.md`; never remove a lock until its recorded owner PID is confirmed dead.
