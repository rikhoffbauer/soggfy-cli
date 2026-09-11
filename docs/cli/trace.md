---
title: trace
---

# `soggfy trace`

Capture downloads emit an append-only JSONL trace. Replay validates coordinator
decisions without launching Spotify, making timing failures reproducible.

## Replay a trace

```bash
soggfy trace replay ~/.soggfy/logs/captures/<trace>.jsonl
```

A successful replay prints a JSON summary with the final phase, command and
status counts, and maximum captured bytes. Invalid traces fail at the first
violated invariant and report its sequence number.

## Recorded evidence

Each line contains a schema version, sequence, monotonic offset, track ID, and
one event: coordinator phase, IPC command/response, playback snapshot, capture
status, byte count, timeout prerequisite, or error.

## Enforced invariants

- Event sequences are contiguous and belong to one track.
- A confirmed target is not started again.
- Captured byte counts never decrease.
- Terminal phases cannot transition back to active work.
- Every timeout names the prerequisite that did not arrive.

Set `SOGGFY_TRACE_DIR` to override the trace directory. Traces may contain
local paths and raw Spotify telemetry; review them before sharing.
