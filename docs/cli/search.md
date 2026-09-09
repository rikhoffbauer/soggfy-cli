# `soggfy search`

Search the Spotify catalog for tracks, artists, and playlists without leaving the terminal.

## Usage

```sh
soggfy search [options] <query...>
```

## Options

| Option | Meaning |
| --- | --- |
| `-t, --type <type>` | `track`, `artist`, `playlist`, or `all` (default). |
| `-n, --limit <n>` | Results per selected type, clamped to 1–50. Default: 10. |
| `--json` | Emit normalized JSON to stdout for scripts. |
| `-h, --help` | Show this document in the terminal. |

## Human output

Each result includes its type, name, secondary attribution, and Spotify URI. Data is written to stdout; errors are written to stderr.

```sh
soggfy search "rick astley"
soggfy search --type track --limit 5 "never gonna give you up"
soggfy search --type playlist "synthwave"
```

## JSON output

```sh
soggfy search --json --type track "massive attack teardrop" | jq '.[].uri'
```

Normalized results have this shape:

```json
{
  "id": "4PTG3Z6ehGkBFwjybzWkR8",
  "uri": "spotify:track:4PTG3Z6ehGkBFwjybzWkR8",
  "type": "track",
  "name": "Never Gonna Give You Up",
  "subtitle": "Rick Astley",
  "imageUrl": "https://..."
}
```

## Search credentials

Catalog search uses Spotify's private Web Player transport and acquires an anonymous Web Player access token plus client token automatically. No Spotify cookie is required for normal search or playlist browsing.

For authenticated web endpoints, or as an explicit override, Soggfy still accepts either `SPOTIFY_COOKIE` containing a valid `sp_dc=...` cookie or both `SPOTIFY_ACCESS_TOKEN` and `SPOTIFY_CLIENT_TOKEN`. The native capture/login path remains separate. If token acquisition or the upstream private API fails, Soggfy exits non-zero with an actionable error and writes no fake/empty result set.

The GUI uses exactly the same shared search implementation and result model as this command.
