# soggfy-cli

A self-contained CLI tool for capturing Spotify audio streams on macOS.

Captures decoded PCM audio from Spotify's playback pipeline via DYLD library injection, then transcodes to your preferred format (MP3, FLAC, WAV, OGG) and streams to stdout or a file.

## Quick Start

```bash
# Install everything (Spotify, dependencies, payload)
soggfy install

# Authenticate with Spotify
soggfy auth login

# Start the background daemon
soggfy daemon start

# Stream a track to a file
soggfy stream -o song.mp3 https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8

# Or pipe to stdout
soggfy stream 4PTG3Z6ehGkBFwjybzWkR8 > song.mp3

# Stream as WAV and pipe to a player
soggfy stream --format wav 4PTG3Z6ehGkBFwjybzWkR8 | ffplay -
```

## Requirements

- macOS (Apple Silicon or Intel)
- [Homebrew](https://brew.sh/)
- [Bun](https://bun.sh/) runtime

## Installation

```bash
git clone <repo-url> soggfy-cli
cd soggfy-cli
bun install
bun run src/cli.ts install
```

Or use it directly:

```bash
bun run src/cli.ts --help
```

## Commands

### `soggfy install`

Downloads and configures all required components:

- Installs brew dependencies (cmake, ffmpeg, capstone, pkg-config)
- Downloads Spotify if not already installed
- Creates a patched copy of Spotify.app (never modifies the original)
- Builds the injection payload (libsoggfy.dylib)
- Signs everything with ad-hoc signatures

Flags:
- `--skip-spotify-install` — Fail if Spotify.app is missing
- `--rebuild` — Clean rebuild of the payload

### `soggfy auth <subcommand>`

Manage Spotify authentication:

| Subcommand | Description |
|------------|-------------|
| `login`    | Open Spotify for interactive login |
| `logout`   | Remove stored credentials |
| `status`   | Show current auth status |
| `export [file]` | Export credentials to a portable JSON file |
| `import <file>` | Import credentials from a file |

### `soggfy daemon <subcommand>`

Manage the background Spotify instance:

| Subcommand | Description |
|------------|-------------|
| `start`    | Start the daemon in the background |
| `stop`     | Stop the daemon |
| `restart`  | Restart the daemon |
| `status`   | Show daemon status |
| `logs`     | Show recent daemon logs |

### `soggfy stream [options] <input>`

Capture and stream audio:

| Option | Description |
|--------|-------------|
| `-o, --output <path>` | Write to file instead of stdout |
| `-f, --format <fmt>` | Output format: `mp3` (default), `wav`, `flac`, `ogg`, `raw` |
| `--keep-wav` | Keep intermediate WAV capture file |
| `--no-daemon` | Don't use daemon; start temporary instance |

Input can be:
- Spotify track URL: `https://open.spotify.com/track/...`
- Spotify URI: `spotify:track:...`
- Bare track ID: `4PTG3Z6ehGkBFwjybzWkR8`
- Album URL (captures all tracks)
- Playlist URL (captures all tracks)

## Architecture

```
soggfy stream <track>
       │
       ├── Resolves track ID from URL/URI
       ├── Connects to daemon (or starts temp instance)
       ├── Sends IPC commands to injected dylib:
       │      set_track → play → monitor → finish
       ├── Reads captured WAV from temp dir
       ├── Transcodes via ffmpeg (if needed)
       └── Streams to stdout or writes to file
```

The injection payload (`libsoggfy.dylib`) hooks CoreAudio/AVFoundation APIs inside a patched copy of Spotify to intercept decoded PCM audio. Communication happens over UNIX domain sockets.

## Data Locations

| Path | Purpose |
|------|--------|
| `~/.soggfy/` | Configuration and workspace |
| `~/.soggfy/workspace/PatchedSpotify.app` | Patched Spotify copy |
| `~/.soggfy/auth/` | Exported credentials |
| `~/.soggfy/logs/` | Daemon logs |
| `~/.soggfy/daemon.pid` | Daemon PID file |
| `/tmp/soggfy_cli.sock` | IPC socket |

## How It Works

1. **Patching**: Copies `/Applications/Spotify.app` to `~/.soggfy/workspace/`, strips Apple code signatures, and applies ad-hoc signatures to allow dylib injection.

2. **Injection**: Launches patched Spotify with `DYLD_INSERT_LIBRARIES` pointing to `libsoggfy.dylib`, which hooks into Spotify's audio pipeline at load time.

3. **Capture**: The dylib intercepts decoded 32-bit float PCM audio from CoreAudio callbacks and writes it to WAV files in a temp directory.

4. **Control**: The CLI communicates with the dylib via UNIX domain socket IPC commands (play, pause, set_track, get_status, etc.).

5. **Transcoding**: After capture, the CLI uses ffmpeg to transcode the WAV to the requested output format.

## Safety

- **Never modifies** `/Applications/Spotify.app`
- All patching happens on a copy in `~/.soggfy/workspace/`
- Spotify runs hidden (no GUI, no Dock icon) with focus suppression
- Ad/analytics DNS domains are blocked by the payload
- Audio output is muted by default during capture

## License

For personal/educational use only.
