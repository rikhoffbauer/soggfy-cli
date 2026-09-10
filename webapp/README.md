# Soggfy Webapp

Bun API server plus React UI served by the Soggfy daemon for queueing Spotify captures and monitoring the daemon-owned capture instance.

## Start

```bash
soggfy daemon start
open http://127.0.0.1:8085
```

The daemon owns the HTTP server lifecycle. Running `bun run src/index.ts` directly is retained only as an internal development path.

## Server endpoints

- `/api/health` — summary of pool/job health.
- `/api/instances` — isolated Spotify instance status and logs.
- `/api/jobs` — revisioned jobs, queue, and instance snapshots; `?since=<revision>` returns `204` when unchanged.
- `/api/jobs/action` — cancel or retry a job by ID.
- `/api/status` — backwards-compatible track status map retained for scripts/older UI.
- `/api/download` — queue track/album/playlist input.
- `/api/stream` — streams an existing queued/capturing job or serves its completed range-capable output; it never implicitly queues a missing track.
- `/api/file` — final file download with a derived filename.
- `/api/download-all` — ZIP of completed outputs.

## Environment

```bash
SOGGFY_HOST=127.0.0.1          # default bind host
SOGGFY_PORT=8085               # default port
SOGGFY_CAPTURE_BACKEND=ogg     # default capture backend
SOGGFY_MUTE_OUTPUT=1           # default daemon capture setting
SOGGFY_HISTORY_LIMIT=250       # retained terminal jobs
SOGGFY_API_TOKEN=...           # required for non-loopback SOGGFY_HOST

# Standalone webapp development only:
SOGGFY_POOL_SIZE=2             # isolated Spotify process pool size
```

`src/index.ts` is only the HTTP/bootstrap composition root. Process supervision, queue scheduling, route construction, runtime state, metadata, outputs, and security live in dedicated `src/server/*` modules. Release builds bundle this server and its frontend assets so daemon runtime does not require a source checkout.

The default loopback listener is tokenless. Any non-loopback bind fails unless `SOGGFY_API_TOKEN` is set. The UI can be opened once with `?token=<token>`; it stores the token in session storage, removes it from the URL, and sends it only to same-origin `/api/*` requests.

## Notes

The UI consumes `/api/jobs` and `/api/health`, renders instance snapshots from the same response, and keeps `/api/status` available for compatibility with older tooling.
