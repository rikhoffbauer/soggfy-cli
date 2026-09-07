# 2026-06-19 review fix pass

## Goal

Address the pre-refactor review findings that still applied after the first continuation pass, without adding new capture/bypass capability.

## Fixed

- Added missing React/shadcn support files:
  - `webapp/src/lib/utils.ts`
  - `webapp/src/hooks/use-mobile.ts`
- Changed server pathing to derive from `import.meta.url` instead of `process.cwd()`.
- Bound the Bun server to `127.0.0.1` by default through `SOGGFY_HOST`.
- Added explicit payload capture backend gating through `SOGGFY_CAPTURE_BACKEND`:
  - `disabled` is the default.
  - `avasset`, `audiounit`, `converter`, `callback`, and `pull` are explicit single-backend modes.
- Changed buffer muting to require `SOGGFY_MUTE_OUTPUT=1`; default diagnostics do not mutate callback buffers.
- Replaced duplicate `set_track` IPC parsing with one exact-prefix branch.
- Fixed IPC socket/read/write error handling and the `socket() == 0` bug.
- Updated `get_metrics` to include `captureBackend` and escaped JSON strings.
- Fixed `soggfy-cli` so multi-word commands work without shell-quoting the entire command.
- Added `SOGGFY_SOCKET_PATH` support to `soggfy-cli`.
- Added playback ID filename sanitization in `StateManager`.
- Added a local `StateManager` fixture test for generated sine-wave PCM and WAV header/data size validation.
- Added repo hygiene ignores for local CLI state, compile commands, and built helper binaries.

## Verification performed in this environment

- `./scripts/run-state-manager-fixture.sh` passes and produces a valid-size WAV fixture.
- `bash -n setup.sh` passes.
- `bash -n scripts/run-state-manager-fixture.sh` passes.
- C++ syntax checks pass for:
  - `soggfy-macos/Payload/StateManager.cpp`
  - `soggfy-macos/soggfy-cli.cpp`
- TypeScript/TSX syntax transpile check passes for all `webapp/src/**/*.ts(x)` and `scripts/doctor.ts`.
- Alias import scan reports zero missing `@/` targets.

## Not verified here

- Bun install/test/build, because Bun is unavailable in this environment.
- macOS dylib build, because this environment is not macOS and lacks Apple frameworks.
- Live Spotify process injection, IPC lifecycle, or audio callback behavior.

## Remaining gaps

- `Payload/Main.mm` still needs to be split into focused modules.
- IPC still uses plain strings rather than newline-delimited JSON request/response framing.
- Job state is still memory-only and should be persisted to disk.
- Search still depends on brittle Spotify web token/cookie behavior.
- Live macOS tests are still required before claiming capture correctness.
