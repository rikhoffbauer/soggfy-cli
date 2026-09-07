# 2026-06-19 Continuation Pass

## Completed in this pass

- Upgraded the React UI from legacy `/api/status` polling to structured `/api/jobs` + `/api/health` polling.
- Added visible operational panels for server health, ready/total instances, active jobs, completed jobs, and failed jobs.
- Added an instance sidebar that shows readiness, busy state, debug port, active track, socket path, heartbeat, last error, and recent instance logs.
- Added rich job rows with explicit state, instance ID, output format, validation warnings, byte progress, expandable diagnostics, recent logs, and signal metrics.
- Added UI controls for cancelling active/queued jobs and retrying failed/cancelled jobs.
- Added server-side `POST /api/jobs/action` with `cancel` and `retry` actions.
- Added queue cancellation without touching Spotify for not-yet-dispatched jobs.
- Added payload-backed active-job cancellation with `cancel_track <trackId>`, partial temp WAV removal, pause, and defensive instance recycle.
- Changed job queueing to return immediately instead of resolving only after capture completion; API calls now report queued state promptly.
- Hardened the job registry so failed/cancelled jobs are terminal, release the per-track reusable mapping, and permit replacement jobs.
- Added tests for failed/cancelled terminal behavior and replacement-job creation.
- Updated architecture, known-failure, webapp, and patch-summary documentation.

## Verification performed here

- TypeScript syntax/transpile checks for modified TS/TSX files with the globally installed TypeScript compiler API.
- `git diff --check` whitespace validation.
- Static checks for destructive setup behavior and shared debug-port collision remain clean.

## Not performed here

- Bun dependency install/test/build; Bun is not installed in this environment.
- macOS CMake payload build; this environment lacks macOS frameworks.
- Live Spotify process, IPC, cancellation, retry, and capture validation.

## Next recommended pass

1. Add protocol-versioned JSON IPC wrappers while keeping old line/string commands as compatibility shims.
2. Decide whether active cancellation can stop recycling once live macOS testing proves `cancel_track <trackId>` is sufficient by itself.
3. Split `Payload/Main.mm` into compile-verified Objective-C++ modules on macOS.
4. Add a payload-side capture-source arbiter to prevent duplicate writes from multiple hooks.
5. Run live macOS verification with `./setup.sh --rebuild`, `bun run scripts/doctor.ts`, and a short controlled capture.
