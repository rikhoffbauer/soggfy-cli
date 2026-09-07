# Known Failure Modes

## Historical failures from the old Ogg hook path

- Dobby hooks against guessed `DecodeAudioData` functions fired but did not prove correct ABI interpretation.
- The server frequently saw missing IPC sockets (`ENOENT`) after Spotify disappeared or the payload crashed.
- Tiny invalid `.ogg` outputs proved that bytes were intercepted, not that a valid stream was captured.
- Heap scans and pointer probing were crash-prone and should remain historical/reference work unless deliberately revived.

## Current PCM/CoreAudio path risks

- Hook readiness can still be false if Spotify updates internal classes/functions.
- Audio duplication risk is reduced by `SOGGFY_CAPTURE_BACKEND`, which gates writes to a single backend, but each backend still needs live macOS validation.
- Audio may be incomplete if capture starts late or duration detection fails.
- WAV headers can be inconsistent if the process exits before `FinishPlayback`.
- ffmpeg can fail on malformed or silent WAV files; the server records validation warnings and falls back only to structurally valid WAV files.
- Search can fail when `SPOTIFY_COOKIE` is missing/expired.
- Pool startup can partially succeed; `/api/instances` must be checked before assuming parallel capacity.

## Recovery behavior added

- Startup surfaces per-instance errors instead of hiding them.
- Idle instances are pinged and recycled when unresponsive.
- Active jobs fail after bounded attempts instead of remaining permanently queued.
- Validation prevents obviously malformed WAV captures from being marked completed.
- MP3 failure falls back to a validated WAV output.


## Cancellation and retry caveats

- Queued jobs are cancelled without touching Spotify.
- Active jobs are cancelled by sending `cancel_track <trackId>`, which drops the partial temp WAV, then pausing/recycling the owning instance as a defensive cleanup step.
- Retrying a failed/cancelled job creates a replacement job record; old failed/cancelled records remain for auditability.
- The UI can request cancel/retry, but live correctness still depends on the macOS payload responding to IPC and the instance recycle path working under `DYLD_INSERT_LIBRARIES`.

## Build/consistency fixes added on 2026-06-19

- Added the missing shadcn alias helpers: `webapp/src/lib/utils.ts` and `webapp/src/hooks/use-mobile.ts`.
- Server root paths are derived from `import.meta.url` instead of `process.cwd()`.
- The IPC server now checks `socket`, `bind`, `listen`, `accept`, `read`, and `send` errors and uses exact prefix parsing.
- Duplicate `set_track` parsing was merged into one path that finishes the previous active track, resets the watchdog, persists the active track ID, and starts the selected backend.
- `soggfy-cli` now joins all command arguments and honors `SOGGFY_SOCKET_PATH`.
- `StateManager` sanitizes playback IDs before using them as filenames.
- A local `StateManager` sine-wave fixture verifies WAV header/data sizing without Spotify.
