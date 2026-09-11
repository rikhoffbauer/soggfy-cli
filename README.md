# soggfy-cli

A macOS CLI and local web service for capturing Spotify track audio from an isolated, patched Spotify process.

The production capture path intercepts Spotify's Ogg/Vorbis stream before decoded audio reaches CoreAudio. Captures are validated with `ffprobe`/`ffmpeg`, then transcoded to the requested output format. Capture is deliberately fail-closed: only the validated Ogg backend is enabled, only one injected process may own a track writer, and unsupported Spotify builds are rejected.

## Compatibility

- macOS on Apple Silicon (`arm64`)
- Spotify **1.2.98.301** and **1.2.99.317 arm64** — exact-supported in `compatibility/spotify-versions.json`
- [Homebrew](https://brew.sh/)
- [Bun](https://bun.sh/)
- CMake, FFmpeg/ffprobe, and Chromaprint (`fpcalc`)

The private capture hooks are version-specific. Production accepts only exact `supported` entries from `compatibility/spotify-versions.json`; the observed min/max span is informational and never an inclusive whitelist. `setup.sh`, `soggfy install`, doctor, and runtime startup reject unrecorded/failed versions, while the native payload independently verifies expected function prologues before installing either private hook.

Use `soggfy compat list` to inspect recorded builds and `soggfy compat probe [Spotify.app]` to apply the current patch to an isolated candidate clone and run native-hook, playback, capture, media-validation, and faceless-runtime checks. `--record` stores the exact result. Spotify 1.2.99.317 was re-analyzed and validated on 2026-09-11; it is recorded as **supported** with version-specific hook targets after playback, full Ogg capture, media validation, and headless checks passed.

## Quick start

```bash
bun install
bun run src/cli.ts install
bun run src/cli.ts auth login
bun run src/cli.ts daemon start

# Capture one track as MP3.
bun run src/cli.ts download \
  -o song.mp3 \
  https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8

# Or run without the daemon.
bun run src/cli.ts download --no-daemon -o song.flac 4PTG3Z6ehGkBFwjybzWkR8
```

Run diagnostics at any time with:

```bash
bun run doctor
```

## Commands

### `soggfy install`

Prepares the local runtime without modifying `/Applications/Spotify.app`:

- checks required tools;
- verifies the installed Spotify version;
- creates `~/.soggfy/workspace/PatchedSpotify.app`;
- builds or installs `libsoggfy.dylib`;
- ad-hoc signs the payload and completed app bundle;
- verifies the resulting bundle signature.

### `soggfy auth <subcommand>`

| Subcommand | Description |
|---|---|
| `login` | Launch the official Spotify process for interactive login |
| `logout` | Remove stored Spotify credentials |
| `status` | Show current authentication status |
| `export [file]` | Export credentials to an owner-only JSON snapshot |
| `import <file>` | Import a credential snapshot after path validation |

Login cleanup terminates only the exact process tree launched by Soggfy; it does not use `killall` or broad command-line matching.

### `soggfy daemon <subcommand>`

| Subcommand | Description |
|---|---|
| `start` | Start the background Spotify instance |
| `stop` | Stop it |
| `restart` | Restart it |
| `status` | Show daemon status |
| `logs` | Show recent daemon logs |

The packaged daemon re-executes the current CLI bundle/executable, so release builds do not depend on source-tree `cli.ts` files.

### `soggfy download [options] <input>`

| Option | Description |
|---|---|
| `-o, --output <path>` | Write to a file or directory instead of stdout |
| `-f, --format <fmt>` | `mp3` (default), `wav`, `flac`, `ogg`, or `raw` |
| `--keep-wav` | Legacy name: keep the intermediate capture instead of deleting it; the production capture is currently Ogg |
| `--no-daemon` | Start a temporary isolated Spotify instance |

Input can be a Spotify track URL/URI, bare 22-character track ID, album URL/URI, or playlist URL/URI. With no `--output`, encoded media is written to stdout; logs and compatibility warnings remain on stderr so pipelines stay binary-safe.

`raw` means uncontainerized PCM and is only valid when the source capture is WAV. The production Ogg capture is therefore rejected for `raw` output instead of having its compressed bytes mislabeled as PCM.

`stream` remains accepted as a compatibility alias for `download`. It emits a deprecation warning on stderr only; new scripts should use `download`.

### `soggfy search [options] <query>`

Searches Spotify for tracks, artists, and playlists using the same normalized search implementation as the web GUI.

| Option | Description |
|---|---|
| `-t, --type <type>` | `track`, `artist`, `playlist`, or `all` (default) |
| `-n, --limit <n>` | Results per selected type, clamped to 1–50 |
| `--json` | Emit stable machine-readable JSON to stdout |

Catalog search works without manual credentials by acquiring Spotify's anonymous Web Player token plus client token. `SPOTIFY_COOKIE` or the pair `SPOTIFY_ACCESS_TOKEN` + `SPOTIFY_CLIENT_TOKEN` can still override that path when authenticated web access is needed. Token/upstream errors are written to stderr and JSON mode never emits partial data. See [`docs/cli/search.md`](docs/cli/search.md) for details.

### CLI help and documentation

The command reference under [`docs/cli/`](docs/cli/) is the source of truth for both the terminal and the documentation website. For example, `soggfy download --help`, `soggfy search --help`, and `soggfy help scripting` render those Markdown documents directly. The static VitePress site builds with `bun run docs:build` and is configured to deploy to [rikhoffbauer.github.io/soggfy-cli](https://rikhoffbauer.github.io/soggfy-cli/) through GitHub Pages.

## Capture pipeline

```text
soggfy download <track>
       │
       ├─ resolve track ID / metadata
       ├─ connect to daemon or start isolated Spotify instance
       ├─ reset_track → set_track → play
       ├─ confirm the requested track is actually playing
       │    └─ retry the AppleEvent play request while Spotify starts
       ├─ native payload validates Ogg hook prologues
       ├─ exactly one process claims .capture-owner for that track
       ├─ write Ogg/Vorbis pages while shared capture gate is open
       ├─ finish_track → wait for shared status=completed
       ├─ validate container, duration, decodeability, RMS/peak/silence
       └─ transcode/stream only after validation succeeds
```

### Native invariants

The native payload enforces these rules:

1. `SOGGFY_CAPTURE_BACKEND=ogg` is the default and the only production capture backend. `disabled` installs no capture hook; any other value is invalid.
2. Ogg capture and fast-decoder mutation are coupled to the same backend policy.
3. A cross-process, atomic `.capture-owner` file elects one writer for a track. Helper processes cannot concurrently write the same output.
4. The main process publishes the track generation and capture gate; helpers consume that shared state instead of independently ungating themselves.
5. Production launch accepts only exact registry-supported Spotify builds, and private decode/Ogg hooks are installed only when the running binary also has the expected machine-code prologues.
6. The remaining CoreAudio wrapper is output muting only. It does not interpret or capture PCM buffers.

## Shared CLI/webapp runtime

The CLI and webapp use the same runtime primitives for:

- `SOGGFY_HOME`, workspace, output, and backend configuration;
- UNIX-socket IPC transport;
- minimal Spotify login-state cloning;
- exact process-tree termination;
- media validation/transcoding helpers;
- exact registry-backed Spotify compatibility checks and isolated candidate probing.

The webapp keeps its job/pool orchestration layer, but its per-instance socket, save directory, profile, cache, home, and `TMPDIR` are isolated under `SOGGFY_HOME`. This makes `SOGGFY_HOME=/tmp/soggfy-test` a practical way to run an isolated service without colliding with another Soggfy client.

The web GUI is organized around the normal user workflow: Spotify search/paste first, then active queue and recent downloads. Instance health and logs remain available under a collapsed diagnostics disclosure instead of occupying the primary workspace. Completed files can be played or saved directly from the history panel.

## Daemon + web service

The daemon owns the patched Spotify process and serves the web UI and `/api/*` routes from the same HTTP server in the same daemon process:

```bash
soggfy daemon start
soggfy lyrics --format lrc spotify:track:3z8h0TU7ReDPLIbEnYhWZb
```

The web layer uses the daemon's live `SpotifyInstance` through an internal in-process API; it does not launch a second Spotify worker. UI and API both use `http://127.0.0.1:8085` by default. Set `SOGGFY_HOST` or `SOGGFY_PORT` before starting/restarting the daemon to override the bind address. Non-loopback binds require `SOGGFY_API_TOKEN`; API clients send it as a bearer token. Wildcard CORS is disabled. Completed web downloads are restored from sidecars after daemon restart, and terminal history is bounded by `SOGGFY_HISTORY_LIMIT` (default `250`).

The daemon-owned patched Spotify copy runs as a macOS background-only application. It has no Dock/app-switcher presence and the injected payload suppresses window ordering/activation, so capture runs without a visible Spotify GUI. The normal `/Applications/Spotify.app` remains unchanged and is still used when interactive login is required.

Important endpoints:

- `GET /api/health`
- `GET /api/instances`
- `GET /api/jobs`
- `GET /api/search?q=<query>`
- `GET /api/playlist?id=<playlist>&offset=<n>&limit=<n>`
- `GET /api/track?id=<track>`
- `POST /api/play`
- `POST /api/playlist/queue-all`
- `GET /api/lyrics?track=<track>`
- `POST /api/jobs/action`
- `POST /api/download`
- `GET /api/status`
- `GET /api/stream?track=<id>&job=<job-id>`
- `GET /api/file?track=<id>`
- `GET /api/download-all`

A completed job contains the validated capture metadata and the final MP3/Ogg/WAV output path. Failed or cancelled jobs remain explicit terminal records.

## Data locations

| Path | Purpose |
|---|---|
| `~/.soggfy/` | Default Soggfy home; override with `SOGGFY_HOME` |
| `~/.soggfy/workspace/PatchedSpotify.app` | Patched Spotify copy |
| `~/.soggfy/workspace/profiles/` | Isolated Spotify profiles |
| `~/.soggfy/runtime/` | Webapp per-instance sockets and capture state |
| `~/.soggfy/output/` | Webapp completed outputs |
| `~/.soggfy/auth/` | Credential exports |
| `~/.soggfy/logs/` | Daemon logs |
| `~/.soggfy/daemon.pid` | Daemon PID file |
| `/tmp/soggfy_cli.sock` | Root CLI daemon IPC socket |
| `/tmp/Soggfy_cli` | Root CLI daemon capture state |

Sensitive/runtime directories are created owner-only. TLS key logging is disabled unless `SOGGFY_SSL_KEYLOG_FILE` is explicitly configured.

## Validation and verification

The repository gates the important paths with:

```bash
bun test
bun run typecheck
bun run test:native
cmake --build soggfy-macos/build -j4
bun run build:cli
bun run docs:build
cd webapp && bun test src/server/__tests__ src/components/soggfy/__tests__ && bun run typecheck && bun run build
bun run doctor
```

On 2026-09-08, a live CLI smoke capture, an isolated webapp API capture, and `soggfy compat probe` were validated against Spotify 1.2.98.301. The test track produced a 213.573-second, 44.1 kHz stereo Vorbis capture; the webapp successfully validated it and produced a tagged MP3 of the same duration. Exact process-tree shutdown left no capture-process leaks.

On 2026-09-11, Spotify 1.2.99.317 passed four consecutive non-instrumented compatibility captures of Eminem’s “8 Mile,” including the recorded probe. The production daemon was then rebuilt on that exact Spotify version and completed “8 Mile,” “Without Me,” “Like Toy Soldiers,” and “The Way I Am” through the Web UI API with full-duration validated audio. “The Way I Am” encountered one Spotify-side pause on its first attempt and recovered on the built-in retry; the other three completed on attempt 1.

## Safety boundaries

- `/Applications/Spotify.app` is never patched in place.
- Unsupported Spotify builds and private-hook prologue mismatches fail closed.
- The capture backend has one writer per track generation.
- Target playback must be confirmed before capture can be accepted.
- Truncated, malformed, silent, mostly silent, or wrong-duration media is rejected.
- App/payload signing failures are fatal instead of warnings.
- Process cleanup targets recorded PIDs/descendants rather than process-name matches.

## License

For personal/educational use only.
