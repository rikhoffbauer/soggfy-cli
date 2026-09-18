# Spotify 1.3.0.277 streamer investigation results

Date: 2026-09-18  
Decision: **GO for the default-off single-instance prefetch implementation on exact Spotify 1.3.0.277 arm64**

The authoritative machine-readable gate result is `results/batch-benchmark.json`. Integrated production acceptance is recorded in `results/production-live-acceptance-20260918.json`; earlier probe/lifecycle evidence remains in `results/phase2-live-probes-20260918.json`.

## Gate B decision

The production gate required at least 10% lower median total fixed-batch time, improvement in every one of three valid paired runs, exact/correct output, and no additional observed capture failures or buffering stalls.

| Metric | Prefetch disabled | Prefetch enabled | Result |
|---|---:|---:|---:|
| Median total 3-track batch time | 114,969.109 ms | 45,938.376 ms | **60.043% faster** |
| Valid paired trials | 3 | 3 | passed |
| Pairs improved | — | 3 / 3 | passed |
| Invalid trials in canonical run | — | 0 | passed |
| Exact output hashes stable | — | yes | passed |
| Additional capture failures | baseline had 2 recovered retries | 0 | passed |
| Additional buffering stalls | none | none | passed |

Per-pair results:

| Pair | Disabled | Enabled | Improvement |
|---|---:|---:|---:|
| 1 | 114,969.109 ms | 45,278.055 ms | **60.617%** |
| 2 | 51,133.914 ms | 46,498.797 ms | **9.065%** |
| 3 | 119,772.533 ms | 45,938.376 ms | **61.645%** |

All three output hash sets were invariant:

- `575BKqgHeL2srecj3MfGX1`: `a2c90be6077c35dcc2706539296fcb8a1073055977d2f8c5ec9f783230958373`
- `05UwCkSH4WUgVGokcJuCdC`: `33f6badbb936d2782a57e1ebdef1e2d573c9838fd26ab058f05485f2422baa50`
- `05V8xN0HWfnipAFIlOEu3W`: `1c3536cdee234855df5527529ca0e2840de590b60826bcdbd447ac80e7d67c7c`

This canonical result supersedes the earlier provisional NO-GO batch result preserved in investigation history. The gate is deterministic; semantic supervision is supplementary and does not override the numeric/correctness criteria.

## What was implemented

Production prefetch is opt-in with `SOGGFY_PREFETCH=1`, default off, and currently registry-enabled only for exact Spotify `1.3.0.277` arm64. Capture support and prefetch support are distinct registry capabilities.

The daemon-backed scheduler observes the next two queued variants while one existing capture owner remains authoritative. A shared renderer adapter resolves the active session's exact selected `(fileId, formatEnum, bitrate)`, resolves matching future variants, uses Spotify's own progressive Download streamer to warm its cache, and keeps protected media bytes inside the renderer. Job/API state receives only bounded status/counters.

A cached speculative variant never counts as a completed download. Before capture, speculative ownership is cancelled/destroyed. Playback then confirms the exact renderer-selected file ID; only an exact match enables the measured `16x` sequential extraction path. A mismatch falls back to ordinary capture and is reported as a prefetch miss.

## Integrated production acceptance

A clean isolated daemon-backed `1.3.0.277` runtime was started with `SOGGFY_PREFETCH=1`. While the first canonical track captured normally, both queued variants were fully prefetched in about 5.24 seconds. The next two jobs independently confirmed exact selected file identity before switching to `16x` extraction.

All three integrated Ogg captures passed media validation and matched the canonical fixture SHA-256 values byte-for-byte. Capture traces show the optimized jobs explicitly switch to `16x` only after exact identity confirmation and restore `12x` on exit.

Lifecycle acceptance also exercised:

- cancelling a job while speculative acquisition was active;
- priority playback interrupting/requeueing an active job without spending an attempt;
- a cached queued job remaining subordinate to normal queue ownership;
- daemon restart with prefetch enabled and healthy IPC/HTTP afterward;
- renderer death during active speculation.

During the renderer-loss test, the exact renderer child was terminated while two queued variants were resolving/fetching. Both queued jobs surfaced `error/cleanup-uncertain`, prefetch disabled itself for that Spotify generation, Chromium later respawned a renderer, and the already-active baseline capture still completed with clean validation. This demonstrates that optional speculation fails closed without replacing or invalidating the authoritative capture pipeline.

See `results/production-live-acceptance-20260918.json` for the persisted summary.

## Scope and limits

This result supports only the implemented design:

- one daemon-owned authenticated Spotify process;
- at most two queued exact-variant speculative acquisitions;
- sequential native Ogg extraction remains singular and authoritative;
- exact build `1.3.0.277` only until another build records `checks.prefetch=true` after equivalent validation;
- default off for the initial release;
- standalone/non-daemon downloads and one-at-a-time CLI batch submission are not promised a throughput improvement.

It does not establish simultaneous native extraction, arbitrary quality selection, offline-download ownership, or universal Spotify-version compatibility.

## Operational restoration

The normal user daemon was intentionally stopped while exact-build acceptance used an isolated `SOGGFY_HOME` under `/Volumes/ssd1/tmp`. Final closure stopped that isolated daemon and restored the default-home daemon with `SOGGFY_PREFETCH` unset. The restored production workspace is exact Spotify `1.2.99.317` (executable SHA-256 `2436057783e94b5c5d8aca5971a1bd46d7b6dee07b4b4cf0e79256551fc75610`), which has capture support but no `checks.prefetch=true`. Daemon identity, Spotify IPC, HTTP health on `127.0.0.1:8085`, owned app/profile paths, empty queue, absence of prefetch-enable logs, and absence of isolated-test processes were all verified.

## Reproduction

The preserved benchmark and probe commands are documented in this directory's `README.md`. The canonical gate result is `results/batch-benchmark.json`; live production acceptance is `results/production-live-acceptance-20260918.json`. Always verify the exact app/version/profile before reproducing private-service behavior.

## Final repository gate

Final closure passed `bun test` with **452/452 tests** (**1,341 expectations across 96 files**), root and web TypeScript checks, native fixtures, payload build, release build, explicit web production build, VitePress docs build and `git diff --check`. Deterministic supervision reports Gate A `PASS`, Gate B `GO`, no failures and no unknowns.
