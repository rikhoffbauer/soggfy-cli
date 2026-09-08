# Soggfy

Soggfy is a macOS Spotify capture CLI and local web application built around explicit capture ownership, validation, and isolated worker instances.

## Start here

```sh
soggfy install
soggfy auth login
soggfy daemon start
soggfy search --type track "rick astley"
soggfy download -o song.mp3 spotify:track:4PTG3Z6ehGkBFwjybzWkR8
```

## Documentation

- [CLI overview](./cli/)
- [`download`](./cli/download.md) — capture to stdout, files, or directories
- [`search`](./cli/search.md) — tracks, artists, and playlists
- [`auth`](./cli/auth.md) — desktop Spotify login state
- [`daemon`](./cli/daemon.md) — reusable capture instance
- [`install`](./cli/install.md) — dependencies, supported Spotify, payload/signing
- [Shell scripting](./guides/scripting.md)
- [Configuration](./guides/configuration.md)
- [Formats and validation](./guides/formats.md)
- [Troubleshooting](./guides/troubleshooting.md)
- [Current architecture](./current-architecture.md)

The command Markdown above is also embedded into the CLI binary and rendered by `soggfy help` / `<command> --help`.
