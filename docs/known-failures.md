# Known Failure Modes

Current as of 2026-09-08.

## Spotify version mismatch

Production support is an exact-version registry. Spotify **1.2.98.301 arm64** is currently supported; unrecorded builds and entries recorded as `failed` are treated as unsupported.

Expected behavior:

- `setup.sh` and `soggfy install` stop before preparing an unsupported app.
- doctor reports the system/workspace version mismatch.
- CLI/webapp runtime refuses an unsupported patched bundle.
- native hook installation also verifies the expected prologues and fails closed if the binary does not match.
- `soggfy compat probe` can test the current patch against an isolated candidate clone without weakening those production checks.

On 2026-09-08, Spotify **1.2.99.317 arm64** was probed with the current implementation. IPC became ready, but both `DecodeAudioData` and `ogg_stream_pagein` reported prologue mismatches, so the registry records that exact build as `failed`.

Do not "fix" this by removing the checks or installing guessed offsets. Re-analyze the new Spotify binary, establish new signatures/offsets, rerun `soggfy compat probe`, and record support only after every probe check passes.

## Spotify startup / AppleEvent `-1708`

A newly launched hidden Spotify process may initially return AppleEvent result `-1708` for `play`. This happened during the successful live smoke test.

Both capture clients retry the target `play` request while waiting for `get_playing` confirmation. If the requested track is never confirmed, capture fails instead of proceeding from `active_track.txt` or another intent-only signal.

## Private hook readiness

A successful IPC `ping` proves the payload/server is alive, not that arbitrary private offsets are valid. `get_capabilities` separately reports `decoderHooksReady`; the Ogg backend sets that flag only after both exact decode and Ogg function prologue checks and hook installations succeed.

If either check fails, the backend logs the mismatch and does not capture. This is preferable to crashing or interpreting an unknown ABI.

## Helper-process injection

Spotify spawns multiple processes. Some platform helper processes can have a different architecture/security posture and may reject an inserted arm64 dylib. The capture design does not require every helper to become a writer: the first compatible injected process that sees the Ogg stream atomically claims the track writer, and all others are excluded.

A helper injection error is therefore not automatically a capture failure; the final media validation and shared completion state remain authoritative.

## Capture never starts

Likely causes:

- authentication/session state is missing or stale;
- target playback never becomes confirmed;
- Spotify version/prologues are unsupported;
- the Ogg stream never reaches an injected compatible process;
- IPC or the owning Spotify process exits.

The client pauses and fails after bounded startup/IPC timeouts. It does not manufacture a successful output from a partial file.

## Capture finalization stalls

`finish_track` is asynchronous across injected processes. Clients now poll shared `get_status` until `completed` rather than assuming a 500 ms delay is enough.

If completion never arrives, the job fails and preserves the capture for diagnosis instead of validating a file while its writer may still be active.

## Invalid, truncated, or silent media

A file existing on disk is not success. `validateAudioFile` checks:

- ffprobe readability/container;
- duration against expected metadata when available;
- actual ffmpeg decodeability;
- decoded RMS/peak;
- silence ratio.

Malformed, near-silent, mostly-silent, or clearly wrong-duration captures are rejected. Webapp transcode fallback is allowed only after the source capture itself has passed validation.

## `raw` output with the Ogg backend

`raw` means raw PCM. The production capture is compressed Ogg/Vorbis, so its bytes cannot be copied directly to a `.raw` stream. The CLI rejects this combination rather than corrupting output. Request WAV/FLAC/MP3/Ogg instead.

## Search failures

Webapp Spotify search depends on `SPOTIFY_COOKIE` and private Spotify web APIs. Missing/expired cookies or upstream API changes can break search independently of capture.

Direct track IDs/URIs/URLs can still be captured when the local authenticated Spotify runtime is healthy.

## Daemon/web readiness

The web server attaches to the daemon-owned Spotify instance. `/api/health` may be reachable before that instance reports ready; check `readyInstances` before queueing capture work. If the daemon-owned Spotify process becomes unresponsive, restart the daemon rather than spawning a second web worker.

## Cancellation and retries

- Queued jobs cancel without touching Spotify.
- Active jobs publish `cancel_track`, pause, and recycle the exact owning instance/process tree as defensive cleanup.
- Failed/cancelled jobs remain for auditability; retry creates a replacement job record.
- Cancellation can preserve diagnostic partial files, but they are never surfaced as completed output without validation.

## Signing failures

Adding/replacing `libsoggfy.dylib` changes the app bundle seal. Setup, CLI install, and webapp payload refresh therefore sign the payload, re-sign the **completed app bundle**, and then run strict deep verification.

A signing or verification error is fatal. Do not downgrade it to a warning: DYLD injection behavior otherwise becomes environment-dependent and difficult to diagnose.

## Disk usage

Do not clone all of Spotify `PersistentCache` for each isolated process. It can contain hundreds of megabytes of updater data and quickly fill the system volume.

The shared login-state helper copies only preferences/`Users`, clone-on-write copies `PersistentCache/Users`, and copies `PersistentCache/user_settings`. `PersistentCache/Update` is intentionally excluded.

## Process cleanup

Runtime and login cleanup track exact root/descendant PIDs. Broad `killall Spotify`, `pkill`, or `pgrep -f` cleanup is intentionally absent because another Spotify/Soggfy-based application may be running concurrently.

If a crash occurs before the owner can clean up, inspect the recorded PID/tree and runtime directory rather than restoring broad name-based termination.
