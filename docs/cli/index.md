# CLI reference

```text
soggfy <command> [options]
```

## Commands

- [`download`](./download.md) — capture audio; stdout remains supported for pipelines.
- [`search`](./search.md) — search tracks, artists, and playlists.
- [`lyrics`](./lyrics.md) — fetch Spotify lyrics with line-synced timestamps when available.
- [`daemon`](./daemon.md) — manage the background capture service, web UI, and API server.
- [`auth`](./auth.md) — manage desktop Spotify login state.
- [`install`](./install.md) — prepare dependencies, supported Spotify, and payload.
- [`fingerprint`](./fingerprint.md) — emit a Chromaprint fingerprint.
- `help [topic]` — render these Markdown documents in the terminal.

`stream` is retained only as a compatibility alias for `download`.

## Global options

- `-h, --help` shows command or top-level help.
- `-v, --version` prints the Soggfy package version.

Use `soggfy help scripting`, `soggfy help configuration`, `soggfy help formats`, or `soggfy help troubleshooting` for guides that are useful directly from a shell.
