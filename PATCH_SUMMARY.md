# Patch Summary — Robustness Refactor

Date: 2026-06-19

## Summary

This patch moves the project from implicit, string-derived status handling toward a supervised capture system with explicit jobs, instance snapshots, health endpoints, safer setup, and output validation.

## Key files changed

- `webapp/src/index.ts` — refactored Bun server with supervised pool, explicit jobs, health/instances/jobs endpoints, synchronous payload preparation, range-capable completed-file serving, bounded retries, output validation, prompt queueing, and cancel/retry actions.
- `webapp/src/server/jobs.ts` — job state machine, terminal-state handling, replacement-job support, and legacy status adapter.
- `webapp/src/server/media.ts` — WAV validation, ffprobe checks, MP3 transcode helper, filename sanitation, sidecar writing.
- `webapp/src/server/http.ts` — CORS, JSON helper, range-capable file serving.
- `webapp/src/server/spotify-url.ts` — Spotify track ID parsing and extraction helpers.
- `setup.sh` — safe flag-driven setup script; no longer deletes `/Applications/Spotify.app`.
- `scripts/doctor.ts` — local diagnostics for dependency and workspace readiness.
- `soggfy-macos/Payload/StateManager.*` — byte/file/limit metric accessors and safer 64-bit byte accounting.
- `soggfy-macos/Payload/Main.mm` — added `get_metrics` IPC command.
- `webapp/src/App.tsx` — upgraded UI to show health, instances, structured jobs, validation warnings, logs, cancel, and retry.
- `docs/current-architecture.md`, `docs/known-failures.md`, `docs/progress/2026-06-19-refactor.md`, `docs/progress/2026-06-19-continuation.md` — architecture, failure modes, progress notes.

## Verification performed here

- TypeScript syntax/transpile checks for modified TS files using the globally installed TypeScript compiler API.
- `git diff --check` whitespace check.
- Static grep confirmed no active setup deletion of `/Applications/Spotify.app` and no active shared `--remote-debugging-port=9222` collision remains outside historical reference files.

## Verification not performed here

- Bun install/test/build because Bun is not installed in this execution environment.
- CMake payload build because the environment is Linux and the payload requires macOS frameworks.
- Live Spotify injection/capture testing because it requires macOS + Spotify runtime.


## Continuation pass additions

- UI now consumes `/api/jobs` + `/api/health` directly instead of relying on the legacy `/api/status` model.
- Added `POST /api/jobs/action` for `cancel` and `retry`.
- Queued jobs can be cancelled without touching Spotify.
- Active jobs can be cancelled with `cancel_track <trackId>`, partial temp WAV cleanup, pause, and instance recycle.
- Retrying a failed/cancelled job creates a new auditable replacement job.
- Added tests for terminal failed/cancelled states and replacement-job creation.

## Review fix pass additions

- Added missing shadcn alias support files: `webapp/src/lib/utils.ts` and `webapp/src/hooks/use-mobile.ts`.
- Replaced `process.cwd()` repo-root inference with `import.meta.url`-based pathing.
- Added `SOGGFY_HOST`, defaulting the Bun server to `127.0.0.1`.
- Added `SOGGFY_CAPTURE_BACKEND`, defaulting to `disabled`, so the payload cannot write from multiple hook paths at once.
- Added `SOGGFY_MUTE_OUTPUT`, defaulting to `0`, so hooked callbacks do not silently mutate output buffers during diagnostics.
- Merged duplicate `set_track` IPC handling into one exact-prefix branch with previous-track finalization and watchdog reset.
- Fixed IPC socket/read/write error handling, including the `socket() == 0` bug.
- Fixed `soggfy-cli` to join command arguments and honor `SOGGFY_SOCKET_PATH`.
- Sanitized `StateManager` playback IDs before constructing output paths.
- Added `soggfy-macos/tests/state_manager_fixture.cpp` and `scripts/run-state-manager-fixture.sh`.
- Removed local-machine/generated artifacts from the packaged tree and added ignore rules for them.
