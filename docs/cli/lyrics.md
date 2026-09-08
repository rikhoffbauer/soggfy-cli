---
title: soggfy lyrics
---
# `soggfy lyrics`

Fetch lyrics from Spotify for a track. Spotify line-synced lyrics retain the original per-line millisecond timestamps.

## Usage

```sh
soggfy lyrics [--format text|json|lrc] <track>
```

`<track>` may be a 22-character Spotify track ID, `spotify:track:` URI, or `open.spotify.com/track/...` URL.

Formats:

- `text` — lyric text only; default.
- `json` — normalized structured data with `source`, `syncType`, language/provider metadata, and line timestamps.
- `lrc` — standard timestamped LRC generated from Spotify `startTimeMs` values.

Examples:
```sh
soggfy lyrics spotify:track:3z8h0TU7ReDPLIbEnYhWZb
soggfy lyrics --format lrc https://open.spotify.com/track/3z8h0TU7ReDPLIbEnYhWZb
soggfy lyrics --format json 3z8h0TU7ReDPLIbEnYhWZb
```

The daemon exposes the same normalized source at:

```text
GET /api/lyrics?track=<spotify-track-id-or-uri-or-url>
```

A Spotify 404 is returned as a structured unavailable response rather than as an internal server failure.

This uses Spotify's private Web Player lyrics endpoint, not the public Spotify Web API. It requires either `SPOTIFY_COOKIE` with an authenticated `sp_dc` cookie or both `SPOTIFY_ACCESS_TOKEN` and `SPOTIFY_CLIENT_TOKEN`.
