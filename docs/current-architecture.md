# Current Architecture

Status: implementation notes for the active macOS/Bun/React fork.

## Truth model

The current implementation is **not** a byte-perfect Ogg/Vorbis dumper. Playback-buffer writes are now gated behind `SOGGFY_CAPTURE_BACKEND`, which defaults to `disabled`. This keeps the default runtime suitable for server/UI/IPC diagnostics and local fixtures without writing captured playback buffers.

When a backend is explicitly selected for controlled local testing, the payload writes decoded float PCM to WAV files, then the server attempts to transcode validated captures to MP3 with ffmpeg. Raw Ogg reverse-engineering work remains in `reference/` and `docs/history/`.

## Runtime pipeline

1. `setup.sh` checks dependencies, prepares `workspace/PatchedSpotify.app`, removes relevant signatures from the copied app, builds `soggfy-macos/build/libsoggfy.dylib`, and installs webapp dependencies.
2. `webapp/src/index.ts` starts a supervised Bun HTTP server and a pool of isolated Spotify instances.
3. Each `SpotifyInstance` starts the patched Spotify binary with:
   - per-instance `SOGGFY_SOCKET_PATH`
   - per-instance `SOGGFY_SAVE_PATH`
   - per-instance user data/profile directories
   - per-instance remote debugging port
   - explicit `SOGGFY_CAPTURE_BACKEND` and `SOGGFY_MUTE_OUTPUT` settings
   - `DYLD_INSERT_LIBRARIES` pointing at the copied and signed payload dylib
4. `Payload/Main.mm` starts IPC in the main process and installs AppKit, path-redirection, network, and audio hooks.
5. `StateManager` receives float PCM, writes a placeholder WAV header, updates it on completion, and exposes byte/status/file metrics over IPC.
6. The Bun server validates WAV structure and basic signal health, transcodes to MP3 when possible, writes a JSON sidecar, and exposes completed output through range-capable HTTP endpoints.
7. React UI consumes `/api/jobs` and `/api/health` for first-class operational visibility while `/api/status` remains available for compatibility.

## Important endpoints

- `GET /api/health` — server, pool, and job summary.
- `GET /api/instances` — supervised Spotify instance state and recent logs.
- `GET /api/jobs` — structured job state, queue, instance snapshots.
- `POST /api/jobs/action` — cancel or retry a job by ID.
- `GET /api/status` — legacy track map retained for compatibility.
- `POST /api/download` — queue a track/album/playlist input.
- `GET /api/stream?track=<id>` — serve completed output with range support; queues missing tracks and returns 202.
- `GET /api/file?track=<id>` — force final file download with a useful filename.
- `GET /api/download-all` — zip all completed validated outputs.

## State machine

Jobs now move through explicit states:

```txt
queued -> assigned -> starting -> playing -> capturing -> finalizing -> transcoding -> completed
   └──────────────> cancelled                                      └──────────────> failed
```

Legacy UI states are derived from this model:

- `queued` / `assigned` => `pending`
- `starting` / `playing` / `capturing` / `finalizing` / `transcoding` => `downloading`
- `completed` => `completed`
- `failed` / `cancelled` => `failed`

## Robustness changes implemented

- Safe setup: `/Applications/Spotify.app` is never deleted.
- Setup flags: `--skip-spotify-install`, `--skip-login`, `--rebuild`, `--reset-workspace`.
- Synchronous payload codesigning before pool startup.
- Unique remote debugging port per instance.
- Socket readiness now requires a real `ping -> pong` handshake.
- Instance snapshots and health endpoints added.
- Watchdog recycles idle instances that stop responding.
- Queue work is represented as explicit `DownloadJob` records.
- Capture output is validated before it can become completed.
- MP3 transcode failure preserves validated WAV instead of pretending MP3 succeeded.
- Completed outputs get JSON sidecars.
- Range-capable serving exists for completed MP3/WAV outputs.
- UI now shows health, instances, structured jobs, validation warnings, progress, logs, cancel controls, and retry controls.
- Capture backend gating prevents simultaneous writes from multiple hook families; default is `disabled`.
- Output-buffer muting is opt-in via `SOGGFY_MUTE_OUTPUT=1`.
- IPC `set_track` handling is single-path and exact-prefix based.
- StateManager has a local sine-wave fixture independent of Spotify/macOS injection.

## Still brittle / next targets

- `Main.mm` is still too large and should be split into `Entry`, `IPC`, `Hooks`, and `Audio` modules.
- Capture backend gating exists, but each backend still needs live macOS validation and the payload should still be split into smaller modules.
- IPC is still line/string-based for most commands; only `get_metrics` returns JSON.
- Active cancellation now asks the payload to `cancel_track`, removes the partial temp WAV, pauses, and then recycles the instance as a defensive cleanup step.
- Spotify search depends on `SPOTIFY_COOKIE` and an unstable private web API.
- Runtime validation on a real macOS machine is still required.
