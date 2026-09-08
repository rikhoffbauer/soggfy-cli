# Current Architecture

Status: active implementation as of 2026-09-08.

## Truth model

The production capture path is an **Ogg/Vorbis stream capture**, not a decoded-PCM capture. `SOGGFY_CAPTURE_BACKEND` defaults to `ogg`; the only other accepted production mode is `disabled`. Unknown backend values fail closed.

Spotify compatibility is exact and registry-backed. Production launch accepts only arm64 versions recorded as `supported` in `compatibility/spotify-versions.json`; the observed min/max supported span is informational only. `DecodeHook.mm` independently checks the expected machine-code prologues before calling `DobbyHook`, and `get_capabilities` reports whether both decoder/Ogg hooks actually installed. Spotify 1.2.98.301 is currently supported; 1.2.99.317 is recorded as failed after both native prologue checks mismatched on 2026-09-08.

## End-to-end pipeline

1. Setup copies `/Applications/Spotify.app` to `~/.soggfy/workspace/PatchedSpotify.app`, builds/copies `libsoggfy.dylib`, signs the payload and completed app bundle, and verifies the signature.
2. The daemon creates the private profile/temp/save directories and clones only the Spotify login state needed for authenticated playback. Non-daemon CLI fallback instances do the same in PID-scoped paths.
3. The patched Spotify process starts with `DYLD_INSERT_LIBRARIES`, a unique IPC socket/save path, an isolated home/TMPDIR/profile/cache, `SOGGFY_CAPTURE_BACKEND=ogg`, and output muting enabled by default.
4. The main injected process starts IPC and publishes shared track-generation/capture-gate state. Helper processes consume the same shared state.
5. `set_track` resets previous track state and starts a new generation. The client sends `play` and keeps retrying while Spotify starts. Capture is not accepted until `get_playing` confirms the requested track.
6. The Ogg beginning-of-stream path atomically claims `.capture-owner`. Only that process may append Ogg pages or enable the accelerated decode mutation.
7. A shared status/control protocol (`.status`, `.duration`, `.finish`, `.cancel`) lets the IPC-owning process and writer process coordinate even when they are different Spotify processes.
8. Capture finishes on Ogg EOS, explicit `finish_track`, duration controls, or cancellation. Clients wait for shared `completed` instead of sleeping for a fixed delay.
9. `validateAudioFile` checks the container with ffprobe, compares duration when known, decodes signal through ffmpeg, and rejects malformed, silent, or mostly-silent output.
10. The CLI streams/transcodes only validated media. The webapp transcodes validated captures to MP3 when possible and preserves the validated Ogg/WAV container if transcode fails.

## Native ownership and gating

The core safety invariant is **one track generation + one backend + one writer**.

`StateManager` uses an atomic owner file created with `O_CREAT | O_EXCL`. Once a process claims a track/source pair, other injected Spotify processes cannot become writers for that generation. Shared state is stored inside the private capture directory rather than process-local memory.

`CapturePolicy` currently exposes:

- `ogg` — install the validated Ogg/decode hooks, allow Ogg writer ownership, and allow the decoder acceleration mutation;
- `disabled` — no capture hooks or decoder mutation;
- anything else — invalid and fail closed.

Unsafe experimental PCM capture families were removed from the production hook selection. The retained `AudioUnitSetProperty` wrapper only replaces Spotify's render callback to zero the final output buffer when muting is enabled; it never interprets the buffer format or writes capture data.

## CLI runtime

The root CLI uses `src/core/*` for paths, IPC, capture control, media validation, Spotify instance lifecycle, login-state cloning, and compatibility checks.

The daemon uses `/tmp/soggfy_cli.sock` and `/tmp/Soggfy_cli` by default. A non-daemon CLI download uses PID-specific temporary socket/save paths and always tears down the exact process tree it started.

The patched workspace copy is prepared with `LSBackgroundOnly=true`. In hidden runtime mode the injected payload also forces `NSApplicationActivationPolicyProhibited` and suppresses `NSWindow` ordering, giving the capture process a faceless/background lifecycle with no visible windows, Dock icon, or app-switcher entry. The stock Spotify application is not modified.

The packaged daemon resolves its current bundle/executable and re-executes that artifact. It does not reference `../cli.ts` at runtime.

## Spotify compatibility probing

`soggfy compat probe [app-path]` is a developer-only validation path for new Spotify builds. It never patches the source application or the production `~/.soggfy/workspace/PatchedSpotify.app`; instead it creates an isolated clone under `~/.soggfy/compat/runs`, applies the current patch unchanged, rebuilds/installs the current payload, ad-hoc signs the clone, and launches it with an explicit compatibility-only `enforceSupportedVersion: false` option. Normal `SpotifyInstance` construction keeps exact registry enforcement enabled.

The candidate must pass patch/sign verification, process launch, IPC, `get_capabilities` with `decoderHooksReady=true`, target playback confirmation, a real capture through the existing `captureTrack` path, existing media validation, and faceless WindowServer/Launch Services checks. `--record` writes the exact result into the tracked registry; only an all-green result becomes `supported`. Failed builds can be recorded for history.

`soggfy compat list` reports exact supported entries plus an observed min/max span. The span never authorizes an untested intermediate version. The probe deliberately does not guess new offsets or signatures when native validation fails.

## Daemon-backed web runtime

The web server is loaded into the daemon process after the daemon-owned `SpotifyInstance` is ready. The daemon registers that live object in a private in-process runtime registry before loading the web module. Web capture operations call the registered instance directly; they do not discover or spawn a second patched Spotify process.

The daemon instance remains the sole owner of `/tmp/soggfy_cli.sock`, `/tmp/Soggfy_cli`, and `$SOGGFY_HOME/workspace/profiles/cli_instance`. The web job scheduler tracks HTTP jobs and media processing around that shared capture instance.

The web layer therefore does not refresh/re-sign the payload or create `runtime/instance_<n>` workers when running inside the daemon. Standalone webapp execution remains an internal development path, not the normal product lifecycle.

## Job state machine

```text
queued -> assigned -> starting -> playing -> capturing -> finalizing -> transcoding -> completed
   └────────────────────────────> cancelled                         └──────────────> failed
```

Legacy states are derived from these structured jobs rather than being the source of truth.

## HTTP endpoints

- `GET /api/health` — daemon/web/job summary (legacy pool fields remain for UI compatibility).
- `GET /api/instances` — per-instance status and recent logs.
- `GET /api/jobs` — structured jobs, queue, and instance snapshots.
- `POST /api/jobs/action` — cancel/retry.
- `GET /api/status` — compatibility status map.
- `POST /api/download` — queue track/album/playlist inputs.
- `GET /api/stream?track=<id>` — range-capable completed output, or 202 while queued/capturing.
- `GET /api/file?track=<id>` — completed file download.
- `GET /api/download-all` — archive completed validated outputs.

## Process lifecycle

Runtime cleanup never uses `pkill`, `pgrep -f`, or `killall`. The shared lifecycle helper builds the exact descendant set from the launched root PID, sends TERM deepest-first/root, then KILLs only surviving members of that same set.

The same principle is used by daemon/fallback CLI instances and interactive auth/setup flows.

## Privacy and filesystem permissions

- Soggfy home/workspace/profile/runtime/log/auth directories are owner-only where they contain runtime or credential state.
- Native per-process logs and ownership/control files are private.
- Auth exports are mode `0600` and imported paths are constrained below Spotify's `Users` directory.
- TLS session-key logging is opt-in only.

## Verification state

Automated verification on 2026-09-08:

- `bun test`: 103 passed, 0 failed.
- root TypeScript: passed.
- native StateManager/CapturePolicy fixture: passed.
- native dylib build: passed.
- bundled CLI build: passed.
- webapp TypeScript + production build: passed.
- compatibility registry/runtime checks: exact support resolves to 1.2.98.301; installed Spotify 1.2.99.317 remains explicitly unsupported.

Live verification on the same date:

- CLI captured `4PTG3Z6ehGkBFwjybzWkR8` as a 4,286,257-byte Ogg/Vorbis file, 44.1 kHz stereo, 213.573333 seconds. Signal validation passed with no warnings.
- The first Spotify AppleEvent returned `-1708`; the retry path later returned success and capture proceeded, validating the startup retry behavior.
- The combined daemon/web runtime was live-smoke-tested on 2026-09-08: HTTP health and UI both returned 200 while process inspection showed exactly one daemon-owned patched Spotify root process and no web-owned `instance_1` worker.
- `soggfy compat probe` passed every check against an isolated clone of the known-good 1.2.98.301 workspace, including real Ogg capture/media validation and zero visible windows.
- The same unchanged patch was applied to an isolated clone of Spotify 1.2.99.317. IPC initialized, but both `DecodeAudioData` and `ogg_stream_pagein` prologue validation failed; the exact build is recorded as `failed` and production support remains 1.2.98.301 only.

## Remaining intentional limitations

- Spotify's private functions remain version-specific. `soggfy compat probe` can determine whether the current implementation survives an update unchanged, but a prologue mismatch still requires deliberate reverse engineering/new validated signatures; automatic best-effort hooking is intentionally not supported.
- Spotify search uses a private web API and `SPOTIFY_COOKIE`; direct track capture does not depend on that search path.
- IPC is still a compact string protocol rather than a typed/versioned protocol.
- Web job scheduling and CLI download orchestration are still separate request layers around the same daemon-owned Spotify instance; high-level cross-client job serialization is not yet centralized.
