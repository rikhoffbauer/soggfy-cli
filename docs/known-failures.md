# Known Failure Modes

Current as of 2026-09-16.

## Spotify version mismatch

Production support is an exact-version registry. Spotify **1.2.98.301**, **1.2.99.317**, and **1.3.0.277 arm64** are currently supported; unrecorded builds and entries recorded as `failed` are treated as unsupported.

Expected behavior:

- `setup.sh` and `soggfy install` stop before preparing an unsupported app.
- doctor reports the system/workspace version mismatch.
- CLI/webapp runtime refuses an unsupported patched bundle.
- native hook installation also verifies the expected prologues and fails closed if the binary does not match.
- `soggfy compat probe` can test the current patch against an isolated candidate clone without weakening those production checks.

On 2026-09-08, Spotify **1.2.99.317 arm64** initially failed because both private hook functions had moved. On 2026-09-11, the new addresses were independently identified from unique function-body matches, added as exact version-specific targets, and revalidated through four consecutive full compatibility captures. The registry now records 1.2.99.317 as `supported`. On 2026-09-16, Spotify **1.3.0.277 arm64** was separately re-analyzed, assigned exact new hook offsets while reusing the validated `OggV1` implementation family, and recorded as `supported` only after the complete captured Ogg and complete canonical decoded PCM matched the known-good whole-track fixture exactly.

Do not "fix" this by removing the checks or installing guessed offsets. Re-analyze the new Spotify binary, establish new signatures/offsets, rerun `soggfy compat probe`, and record support only after every probe check passes.

## Playback starts then stalls

Spotify 1.2.98.301 can accept the AppleEvent play-track command, start decoding, then replace the context via auto_play_on_load and stop with AdvanceStuck/unplayable. This also reproduced with the original signed app. Soggfy uses the original signed bundled spotify_cli instead, after verifying that the receiving process owns local control port 7768. An occupied control port fails explicitly; close the competing runtime before capture. A successful command is issued once; a lost response never triggers a replay.

get_playing reports the actual track, state and position. A matching URI alone is insufficient. Captures fail if playback remains paused, stopped, on another track, or non-advancing for 30 seconds. Unchanged byte count never means EOS.

## Private hook readiness

A successful IPC `ping` proves the payload/server is alive, not that arbitrary private offsets are valid. `get_capabilities` separately reports `decoderHooksReady`; the Ogg backend sets that flag only after both exact decode and Ogg function prologue checks and hook installations succeed.

If either check fails, the backend logs the mismatch and does not capture. This is preferable to crashing or interpreting an unknown ABI.

## Helper-process injection

Spotify also launches shell utilities to verify local API clients. Redirecting their stdout breaks parsing, and inherited arm64 DYLD injection can crash arm64e system tools such as lsof. The payload classifies its host before any filesystem or stdio changes. Unrelated shell children remove DYLD_INSERT_LIBRARIES and return without hooks or logs. Compatible Spotify helpers still participate in atomic writer election.

## Capture never starts

Likely causes:

- authentication/session state is missing or stale;
- target playback never becomes confirmed;
- Spotify version/prologues are unsupported;
- the Ogg stream never reaches an injected compatible process;
- IPC or the owning Spotify process exits.

The Ogg hook keeps a bounded pre-roll from the selected track generation while playback confirmation is still gated. This prevents losing the stream's only Vorbis BOS page when Spotify starts decoding slightly before `PlaybackStateChanged` confirms the requested URI. Pre-roll is discarded on ads, non-target playback, track resets, and overflow.

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

Spotify search and playlist browsing use private Spotify Web Player APIs. They acquire anonymous web/client tokens by default, so a cookie is not normally required; token-endpoint or Pathfinder changes can still break catalog browsing independently of capture. Optional authenticated cookie/direct-token overrides can fail separately if they expire.

Direct track IDs/URIs/URLs can still be captured when the local authenticated Spotify runtime is healthy.

## Daemon/web readiness

The web server attaches to the daemon-owned Spotify instance and does not begin listening until that attachment succeeds. A reachable `/api/health` therefore implies the initial daemon-backed pool is ready; `readyInstances` remains useful for detecting a later runtime failure. If the daemon-owned Spotify process becomes unresponsive, restart the daemon rather than spawning a second web worker.

## Cancellation and retries

- Queued jobs cancel without touching Spotify.
- Active jobs publish `cancel_track`, pause, and recycle the exact owning instance/process tree as defensive cleanup.
- Failed/cancelled jobs remain for auditability; retry creates a replacement job record.
- Cancellation can preserve diagnostic partial files, but they are never surfaced as completed output without validation.

## Signing failures

The original Spotify signature on `spotify_cli` is required for local API authentication. Recursive ad-hoc signing destroys it. All installers and refresh paths use `signSpotifyBundle`, signing only the payload, capture helpers/framework and outer app; deep **verification** remains enabled. An old patched app with an ad-hoc CLI must be rebuilt from an official supported bundle.

Adding/replacing `libsoggfy.dylib` changes the app bundle seal. Setup, CLI install, and webapp payload refresh therefore sign the payload, re-sign the **completed app bundle**, and then run strict deep verification. Spotify 1.3.0.277 additionally requires removing CEF’s existing Developer ID signature before ad-hoc re-signing it; older validated 1.2.x builds retain the direct replacement signing path.

A signing or verification error is fatal. Do not downgrade it to a warning: DYLD injection behavior otherwise becomes environment-dependent and difficult to diagnose.

## Disk usage

Do not clone all of Spotify `PersistentCache` for each isolated process. It can contain hundreds of megabytes of updater data and quickly fill the system volume.

The shared login-state helper copies only preferences/`Users`, clone-on-write copies `PersistentCache/Users`, and copies `PersistentCache/user_settings`. `PersistentCache/Update` is intentionally excluded.

## Process cleanup

Runtime and login cleanup track exact root/descendant PIDs. Broad `killall Spotify`, `pkill`, or `pgrep -f` cleanup is intentionally absent because another Spotify/Soggfy-based application may be running concurrently.

If a crash occurs before the owner can clean up, inspect the recorded PID/tree and runtime directory rather than restoring broad name-based termination.
