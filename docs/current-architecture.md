# Current Architecture

Status: active implementation as of 2026-09-08.

## Truth model

The production capture path is an **Ogg/Vorbis stream capture**, not a decoded-PCM capture. `SOGGFY_CAPTURE_BACKEND` defaults to `ogg`; the only other accepted production mode is `disabled`. Unknown backend values fail closed.

The private native hooks are validated specifically for **Spotify 1.2.98.301 arm64**. Setup, CLI install/runtime, webapp startup, and doctor all check the bundle version, while `DecodeHook.mm` additionally checks the expected machine-code prologues before calling `DobbyHook`.

## End-to-end pipeline

1. Setup copies `/Applications/Spotify.app` to `~/.soggfy/workspace/PatchedSpotify.app`, builds/copies `libsoggfy.dylib`, signs the payload and completed app bundle, and verifies the signature.
2. A CLI or webapp instance creates private profile/temp/save directories and clones only the Spotify login state needed for authenticated playback. The large update cache is not duplicated.
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

The daemon uses `/tmp/soggfy_cli.sock` and `/tmp/Soggfy_cli` by default. A non-daemon stream uses PID-specific temporary socket/save paths and always tears down the exact process tree it started.

The packaged daemon resolves its current bundle/executable and re-executes that artifact. It does not reference `../cli.ts` at runtime.

## Webapp runtime

The webapp has its own job and pool orchestration but shares the low-level runtime primitives with the CLI. Per-instance runtime state lives below:

```text
$SOGGFY_HOME/runtime/instance_<n>/
$SOGGFY_HOME/runtime/instance_<n>.sock
$SOGGFY_HOME/workspace/profiles/instance_<n>/
```

This avoids global `/tmp/soggfy_instance_*` collisions and makes isolated smoke/integration runs possible simply by setting a different `SOGGFY_HOME`.

The webapp refreshes the payload from the current native build before pool startup, then re-signs and strictly verifies the completed patched app bundle.

## Job state machine

```text
queued -> assigned -> starting -> playing -> capturing -> finalizing -> transcoding -> completed
   └────────────────────────────> cancelled                         └──────────────> failed
```

Legacy states are derived from these structured jobs rather than being the source of truth.

## HTTP endpoints

- `GET /api/health` — service/pool/job summary.
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

The same principle is used by CLI instances, webapp instances, and interactive auth/setup flows.

## Privacy and filesystem permissions

- Soggfy home/workspace/profile/runtime/log/auth directories are owner-only where they contain runtime or credential state.
- Native per-process logs and ownership/control files are private.
- Auth exports are mode `0600` and imported paths are constrained below Spotify's `Users` directory.
- TLS session-key logging is opt-in only.

## Verification state

Automated verification on 2026-09-08:

- `bun test`: 44 passed, 0 failed.
- root TypeScript: passed.
- native StateManager/CapturePolicy fixture: passed.
- native dylib build: passed.
- bundled CLI build: passed.
- webapp TypeScript + production build: passed.
- doctor: all checks passed, including system/workspace Spotify 1.2.98.301.

Live verification on the same date:

- CLI captured `4PTG3Z6ehGkBFwjybzWkR8` as a 4,286,257-byte Ogg/Vorbis file, 44.1 kHz stereo, 213.573333 seconds. Signal validation passed with no warnings.
- The first Spotify AppleEvent returned `-1708`; the retry path later returned success and capture proceeded, validating the startup retry behavior.
- An isolated webapp (`SOGGFY_HOME=/tmp/...`, unique HTTP/debug ports) captured the same track in one job attempt, validated the Ogg, transcoded/tagged an MP3 of the same duration, and shut down with no leaked capture process or listening test port.

## Remaining intentional limitations

- Spotify's private functions remain version-specific. A Spotify update requires deliberate re-analysis/new validated signatures; automatic best-effort hooking is intentionally not supported.
- Spotify search uses a private web API and `SPOTIFY_COOKIE`; direct track capture does not depend on that search path.
- IPC is still a compact string protocol rather than a typed/versioned protocol.
- CLI daemon orchestration and webapp pool/job orchestration remain separate higher-level products, though they now share the runtime primitives that previously diverged.
