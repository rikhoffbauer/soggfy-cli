# `soggfy download`

Capture Spotify tracks, albums, or playlists and write the resulting audio to stdout, a file, or a directory.

## Usage

```sh
soggfy download [options] <track|album|playlist>...
```

Inputs may be Spotify URLs or URIs; bare 22-character IDs are accepted as tracks. With no `--output`, encoded media is written to stdout. Progress, warnings, and diagnostics stay on stderr, so shell pipelines remain binary-safe.

## Options

| Option | Meaning |
| --- | --- |
| `-o, --output <path>` | Write to a file or directory instead of stdout. |
| `-f, --format <fmt>` | `mp3` (default), `wav`, `flac`, `ogg`, or `raw`. |
| `--keep-wav` | Keep the intermediate capture file. This is a legacy option name; production capture is Ogg. |
| `--no-daemon` | Start a temporary Spotify instance instead of reusing the daemon. |
| `-h, --help` | Show this document in the terminal. |

Output format is inferred from a file extension when possible. A directory output gets metadata-based filenames and numeric prefixes for multi-track inputs.

## Examples

```sh
# Stream an MP3 to stdout
soggfy download 4PTG3Z6ehGkBFwjybzWkR8 > song.mp3

# Save one track as FLAC
soggfy download -o song.flac https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8
```

```sh
# Capture a playlist into a directory
soggfy download -o ~/Music/Soggfy/ https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M

# Feed WAV into another process
soggfy download --format wav spotify:track:4PTG3Z6ehGkBFwjybzWkR8 | ffplay -

# Force an isolated temporary Spotify instance
soggfy download --no-daemon -o ./track.ogg -f ogg spotify:track:4PTG3Z6ehGkBFwjybzWkR8
```

## Capture lifecycle

Soggfy resolves the input to track IDs, confirms that Spotify is actually playing the requested track, captures the live Ogg/Vorbis stream, finalizes it, validates duration and decoded signal, then transcodes/tags when the requested format requires it. Invalid or mostly silent output is rejected rather than reported as a successful download.

When multiple tracks are requested, they are processed sequentially by this command. The web GUI can run a pool of isolated Spotify instances for parallel jobs.

## Compatibility alias

`soggfy stream` still invokes this command for older scripts, but it is deprecated. Its warning is written to stderr and therefore does not corrupt redirected media.

## Exit behavior

A non-zero exit status means resolution, Spotify startup/playback confirmation, capture, validation, transcoding, or output failed. Do not treat a created file as success unless the command itself exits successfully.
