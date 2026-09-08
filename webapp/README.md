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
- `/api/jobs` — structured jobs, queue, and instance snapshots.
- `/api/jobs/action` — cancel or retry a job by ID.
- `/api/status` — backwards-compatible track status map retained for scripts/older UI.
- `/api/download` — queue track/album/playlist input.
- `/api/stream` — range-capable completed output stream; queues missing tracks and returns 202.
- `/api/file` — final file download with a derived filename.
- `/api/download-all` — ZIP of completed outputs.

## Environment

```bash
SOGGFY_HOST=127.0.0.1          # default bind host
SOGGFY_PORT=8085               # default port
SOGGFY_CAPTURE_BACKEND=ogg     # default capture backend
SOGGFY_MUTE_OUTPUT=1           # default daemon capture setting

# Standalone webapp development only:
SOGGFY_POOL_SIZE=2             # isolated Spotify process pool size
```

`src/index.ts` derives the repository root from `import.meta.url`, so the internal standalone development path does not depend on the caller's working directory.

## Notes

The UI consumes `/api/jobs` and `/api/health`, renders instance snapshots from the same response, and keeps `/api/status` available for compatibility with older tooling.
