# HANDOVER

## Current state

As of 2026-09-17, the four findings from [REVIEW.md](REVIEW.md) are addressed in the working tree based on `87ccbff` (`fix: retire stale standalone spotify before daemon start`). The 2026-09-08 review baseline is preserved in [REVIEW-2026-09-08.md](REVIEW-2026-09-08.md).

Daemon-backed CLI downloads now enter the same `SpotifyPoolManager` scheduler used by the web API, bind to the exact returned job, and fail closed rather than using direct shared IPC when a daemon exists without its scheduler API. Loopback API requests now require a loopback request host; mutations additionally enforce the centralized origin/fetch-metadata/JSON boundary, and configured loopback tokens are enforced. Standalone retained or failed captures move to `~/.soggfy/captures` before runtime cleanup. Completed jobs whose saved artifact disappeared no longer block replacement downloads. Runtime-build test timeouts/cleanup and stale-lock operator guidance are also addressed.

Current verification: `bun test` passes **427/427** tests (1,271 expectations, 93 files); root and web TypeScript checks pass; all native fixtures pass; docs build passes; native payload build passes; CLI/web-runtime release builds pass; `git diff --check` passes. The remediation-focused cross-boundary suite passes 40/40. No fresh authenticated Spotify capture was run during this remediation; historical 2026-09-10 live results below remain historical rather than being presented as current verification.

The system volume is nearly full. During verification, repeated ignored web-runtime builds had accumulated 98 immutable directories under `dist/webapp/versions`, causing a temporary `ENOSPC` while a release test copied the tree into `/tmp`. With no active publisher or lock, only the ignored generated `dist/webapp` tree was cleared and rebuilt. Keep generated build accumulation in mind during repeated local verification.

## Next actions

- Run a fresh supported-version daemon-backed CLI/web capture smoke before release if live-runtime confirmation is required.
- Verify the final commit remains clean after the release gate; do not weaken the scheduler/API/retention fail-closed behavior to accommodate environment issues.
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
