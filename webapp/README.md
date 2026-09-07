# Soggfy Webapp

Bun API server plus React UI for queueing Spotify captures and monitoring the local capture pool.

## Start

```bash
cd webapp
bun run src/index.ts
```

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
SOGGFY_POOL_SIZE=2             # isolated Spotify process pool size
SOGGFY_CAPTURE_BACKEND=disabled # default: no playback buffer writes
SOGGFY_MUTE_OUTPUT=0           # default: do not mutate audio buffers
```

`src/index.ts` derives the repository root from `import.meta.url`, so the documented `cd webapp && bun run src/index.ts` command no longer depends on the caller's current working directory beyond being inside the repository checkout.

## Notes

The UI consumes `/api/jobs` and `/api/health`, renders instance snapshots from the same response, and keeps `/api/status` available for compatibility with older tooling.
