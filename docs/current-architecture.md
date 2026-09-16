# Current Architecture

Status: active implementation as of 2026-09-16.

## Truth model

The production capture path is an **Ogg/Vorbis stream capture**, not a decoded-PCM capture. `SOGGFY_CAPTURE_BACKEND` defaults to `ogg`; the only other accepted production mode is `disabled`. Unknown backend values fail closed.

Spotify compatibility is exact and registry-backed. Production launch accepts only arm64 versions recorded as `supported` in `compatibility/spotify-versions.json`; the observed min/max supported span is informational only. `DecodeHook.mm` selects exact per-version hook targets and then dispatches through a named implementation family, allowing multiple builds to share behavior only when that ABI/behavior has been validated. It independently checks expected machine-code prologues before calling `DobbyHook`, and `get_capabilities` reports whether both decoder/Ogg hooks actually installed. Spotify 1.2.98.301, 1.2.99.317, and 1.3.0.277 are currently supported.

## End-to-end pipeline

1. Setup copies `/Applications/Spotify.app` to `~/.soggfy/workspace/PatchedSpotify.app`, builds/copies `libsoggfy.dylib`, signs the payload and completed app bundle, and verifies the signature.
2. The daemon creates the private profile/temp/save directories and clones only the Spotify login state needed for authenticated playback. The owned snapshot includes the minimal Application Support state plus Spotify’s WebKit session state required by 1.2.99. Existing snapshots may gain that WebKit state only when the owned and official Spotify usernames match; explicit logout still suppresses future automatic imports. Non-daemon CLI fallback instances use the same auth source in PID-scoped runtime paths.
3. The patched Spotify process starts with `DYLD_INSERT_LIBRARIES`, a unique IPC socket/save path, an isolated home/TMPDIR/profile, `SOGGFY_CAPTURE_BACKEND=ogg`, and output muting enabled by default. Soggfy keeps an isolated Chromium `--user-data-dir` but does not override `--cache-path`, because an empty custom cache path invalidates Spotify 1.2.99 authentication.
4. The main injected process starts IPC and publishes shared track-generation/capture-gate state. Helper processes consume the same shared state.
5. `set_track` resets previous track state and starts a new generation. Native `play` verifies its local control listener and the bundled Spotify CLI signature, then executes one CLI playback command. `get_playing` must confirm the exact track, playing state and positive position. Lost command replies never cause replay.
6. Ogg pages arriving before target confirmation are retained only in a bounded generation-scoped pre-roll. Once the requested URI is confirmed, the matching Vorbis BOS/header pages are promoted and the Ogg path atomically claims `.capture-owner`. Ads, non-target playback, resets, and overflow discard pre-roll. Only the elected process may append Ogg pages or enable accelerated decode mutation.
7. A shared status/control protocol (`.status`, `.duration`, `.finish`, `.cancel`) lets the IPC-owning process and writer process coordinate even when they are different Spotify processes.
8. Capture finishes on Ogg EOS, explicit `finish_track`, duration controls, or cancellation. Byte stagnation is never treated as EOS; a 30-second playback-position stall fails the job. Clients wait for shared `completed` instead of sleeping for a fixed delay.
9. Daemon identity replies tolerate readiness clients disconnecting during synchronous startup work. A restart also retires only an orphaned Soggfy-owned Spotify root that matches the exact patched binary/profile and a kernel-birth process fingerprint before launching its replacement.
10. `validateAudioFile` checks the container with ffprobe, compares duration when known, decodes signal through ffmpeg, and rejects malformed, silent, or mostly-silent output.
11. The CLI streams/transcodes only validated media. The webapp transcodes validated captures to MP3 when possible and preserves the validated Ogg/WAV container if transcode fails.

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

The candidate must pass patch/sign verification, process launch, IPC, `get_capabilities` with `decoderHooksReady=true`, target playback confirmation, a real capture through the existing `captureTrack` path, existing media validation, exact whole-track fixture equality, and faceless WindowServer/Launch Services checks. The fixture requires both byte-for-byte equality of the complete captured file and equality of the complete audio decoded to 44.1 kHz stereo `s16le`. The zero-window CoreGraphics helper has a bounded 20-second deadline so compiler startup cannot hang a probe. `--record` writes the exact result into the tracked registry; only an all-green result becomes `supported`. Failed builds can be recorded for history.

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

Legacy states are derived from these structured jobs rather than being the source of truth. Priority Play marks only interruptible capture states, cancels that native capture, then requeues the same job at the front of normal work with its attempt counter restored; the restarted capture begins from byte zero.

## HTTP endpoints

- `GET /api/health` — daemon/web/job summary (legacy pool fields remain for UI compatibility).
- `GET /api/instances` — per-instance status and recent logs.
- `GET /api/jobs` — structured jobs, queue, and instance snapshots.
- `POST /api/jobs/action` — cancel/retry.
- `GET /api/status` — compatibility status map.
- `GET /api/search?q=<query>` — normalized Spotify catalog search.
- `GET /api/playlist?id=<playlist>&offset=<n>&limit=<n>` — playlist metadata and paged tracks without queue mutation.
- `GET /api/track?id=<track>` — normalized single-track metadata.
- `POST /api/play` — priority-play a track, interrupting an active capture when needed.
- `POST /api/playlist/queue-all` — explicitly queue every playable track in a playlist.
- `POST /api/download` — queue track/album/playlist inputs.
- `GET /api/stream?track=<id>&job=<job-id>` — streams newly appended bytes from that exact active Ogg capture; completed outputs remain range-capable.
- `GET /api/file?track=<id>` — completed file download.
- `GET /api/download-all` — archive completed validated outputs.

## Process lifecycle

Runtime cleanup never uses `pkill`, `pgrep -f`, or `killall`. The shared lifecycle helper builds the exact descendant set from the launched root PID, sends TERM deepest-first/root, then KILLs only surviving members of that same set. Legacy-daemon retirement additionally fingerprints the daemon with macOS kernel process birth metadata from `proc_pidinfo(PROC_PIDTBSDINFO)` at microsecond resolution and rechecks it before signals; if that identity cannot be proven, automatic retirement fails closed.

The same principle is used by daemon/fallback CLI instances and interactive auth/setup flows.

## Privacy and filesystem permissions

- Soggfy home/workspace/profile/runtime/log/auth directories are owner-only where they contain runtime or credential state.
- Native per-process logs and ownership/control files are private.
- Auth exports are mode `0600` and imported paths are constrained below Spotify's `Users` directory.
- TLS session-key logging is opt-in only.

## Verification state

The 2026-09-10 playback repair and four-track evidence are recorded in [Playback verification](./playback-verification.md). The following results describe the earlier baseline.

Automated verification on 2026-09-08:

- `bun test`: 263 passed, 0 failed.
- root TypeScript: passed.
- native StateManager/CapturePolicy fixture: passed.
- native dylib build: passed.
- bundled CLI build: passed.
- webapp TypeScript + production build: passed.
- compatibility registry/runtime checks: exact support includes 1.2.98.301, 1.2.99.317, and 1.3.0.277.

Live verification on the same date:

- CLI captured `4PTG3Z6ehGkBFwjybzWkR8` as a 4,286,257-byte Ogg/Vorbis file, 44.1 kHz stereo, 213.573333 seconds. Signal validation passed with no warnings.
- The first Spotify AppleEvent returned `-1708`; the retry path later returned success and capture proceeded, validating the startup retry behavior.
- The combined daemon/web runtime was live-smoke-tested on 2026-09-08: HTTP health and UI both returned 200 while process inspection showed exactly one daemon-owned patched Spotify root process and no web-owned `instance_1` worker.
- `soggfy compat probe` passed every check against an isolated clone of the known-good 1.2.98.301 workspace, including real Ogg capture/media validation and zero visible windows.
- Spotify 1.2.99.317 was re-analyzed on 2026-09-11 after its private functions moved. Exact version-specific hook targets were added, both prologues remained fail-closed, and four consecutive non-instrumented “8 Mile” compatibility captures passed all checks before support was recorded. The production daemon then completed multiple additional Eminem tracks through the Web UI API with independently validated full-duration MP3 output.
- Spotify 1.3.0.277 was validated on 2026-09-16 against commit `ade33aa`. Its new exact hook offsets map to the existing `OggV1` implementation family; the recorded isolated probe passed signing, native hook readiness, playback, complete capture/media validation, exact Ogg and decoded-PCM fixture equality, and faceless/zero-window checks before support was recorded.

## Remaining intentional limitations

- Spotify's private functions remain version-specific. `soggfy compat probe` can determine whether the current implementation survives an update unchanged, but a prologue mismatch still requires deliberate reverse engineering/new validated signatures; automatic best-effort hooking is intentionally not supported.
- Spotify search and playlist browsing use private Web Player APIs and anonymous web/client tokens by default; optional authenticated cookie/direct-token overrides remain supported. Direct track capture does not depend on that catalog path.
- IPC is still a compact string protocol rather than a typed/versioned protocol.
- Web job scheduling and CLI download orchestration are still separate request layers around the same daemon-owned Spotify instance; high-level cross-client job serialization is not yet centralized.

## Daemon and web runtime integrity

The daemon records `{pid, token, startedAt}` and owns a private Unix-domain identity socket. `status` and `stop` trust a PID only when the live socket proves the matching launch token, preventing stale/reused PID files from targeting unrelated processes. `daemon start` is serialized by an atomic start lock, and all startup failures use the same cleanup path that stops the daemon-owned Spotify process.

Release artifacts contain a bundled `webapp/server.js` plus generated frontend assets. The release smoke test copies that runtime outside the source checkout and requires both `/api/health` and the HTML UI to respond, so runtime operation cannot accidentally depend on repository TypeScript files.

Completed web downloads are reconstructed from sidecars on startup. Terminal history is bounded, and job snapshots carry a monotonic revision; unchanged `GET /api/jobs?since=<revision>` requests return `204`, avoiding full idle snapshot retransmission and stale client overwrites.

The web server is decomposed into route composition (`webapp/src/index.ts`), process/capture supervision (`server/spotify-instance.ts`), queue scheduling (`server/pool.ts`), runtime state/configuration, metadata, output lookup, and security modules.
