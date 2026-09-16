# Configuration and environment

Soggfy intentionally has a small configuration surface. Runtime state defaults to `~/.soggfy` and can be redirected for isolated tests or multiple installations.

## Shared paths

| Variable | Purpose |
| --- | --- |
| `SOGGFY_HOME` | Root for runtime state, downloads, profiles, logs, and workspace. |
| `SOGGFY_CAPTURE_BACKEND` | Native capture mode. Production supports `ogg` (default) or `disabled`. |

## Daemon and web server

| Variable | Default | Purpose |
| --- | --- | --- |
| `SOGGFY_HOST` | `127.0.0.1` | HTTP bind address. |
| `SOGGFY_PORT` | `8085` | HTTP port. |
| `SOGGFY_MAX_ATTEMPTS` | `3` | Job attempt limit. |
| `SOGGFY_MUTE_OUTPUT` | `1` | Mute audible Spotify output while capturing. |
| `SOGGFY_HISTORY_LIMIT` | `250` | Maximum terminal jobs retained in the in-memory/history view. |
| `SOGGFY_API_TOKEN` | unset | Required bearer token whenever `SOGGFY_HOST` is not loopback. |

The normal runtime has one daemon-owned Spotify instance. The daemon and web UI/API share that same instance in-process; no additional web worker is created.

The default loopback listener is intentionally tokenless. Binding to a non-loopback address (for example `0.0.0.0`) fails closed unless `SOGGFY_API_TOKEN` is set. API clients then send `Authorization: Bearer <token>`. The web UI accepts `?token=<token>` once, stores it in session storage, removes it from the visible URL, and sends it only to same-origin `/api/*` requests. Wildcard CORS is not enabled.

## Spotify web data

`soggfy search` and playlist browsing use Spotify Web Player authentication and acquire anonymous web/client tokens automatically. `soggfy lyrics` and authenticated private endpoints may still require an authenticated credential set. To override the anonymous path or enable authenticated access, supply one of these credential sets:

```sh
export SPOTIFY_COOKIE='sp_dc=...; sp_key=...'
```

or:

```sh
export SPOTIFY_ACCESS_TOKEN='...'
export SPOTIFY_CLIENT_TOKEN='...'
```

Web credentials are not written into Soggfy's auth export. Avoid placing them in shell history, source control, or world-readable files.

Normal search/playlist browsing needs no manual credential. Personal-library access (`GET /api/library`) instead reuses Soggfy's existing authenticated desktop session: the managed Spotify renderer exposes a loopback-only DevTools port, Soggfy reads its Spotify-domain cookies, and the resulting short-lived access token stays in Soggfy process memory. No separate Spotify OAuth registration or second login is required.

`SPOTIFY_COOKIE` with an authenticated `sp_dc` value remains an explicit Soggfy-side override when renderer cookie access is unavailable. When supplying search tokens directly, provide both `SPOTIFY_ACCESS_TOKEN` and `SPOTIFY_CLIENT_TOKEN`; these anonymous/catalog-token overrides are not a substitute for an authenticated personal-library session.

## Output and runtime state

Completed GUI downloads live under `~/.soggfy/downloads` unless `SOGGFY_HOME` changes it. CLI `download` writes wherever `--output` points, or to stdout when no output path is supplied.

Use a temporary `SOGGFY_HOME` for smoke tests to guarantee isolation:

```sh
SOGGFY_HOME=/tmp/soggfy-smoke soggfy daemon start
```
