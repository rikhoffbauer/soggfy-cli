# Troubleshooting

Start with `bun run doctor` in a source checkout. It checks command dependencies, Spotify versions, patched app state, payload presence, webapp dependencies, output permissions, and capture backend.

## Unsupported Spotify build

Production support comes from exact `supported` entries in `compatibility/spotify-versions.json`; currently that is Spotify 1.2.98.301 arm64. Unrecorded and failed versions are rejected even if their version number lies between two supported builds. The native payload independently verifies the expected function prologues before installing private hooks.

Use `soggfy compat list` to inspect the registry and `soggfy compat probe /Applications/Spotify.app --keep --json` to test a candidate in an isolated clone without changing production state. Add `--record` only when you want to persist the exact result.

Spotify 1.2.99.317 was tested on 2026-09-08: IPC initialized, but `DecodeAudioData` and `ogg_stream_pagein` both failed their current prologue checks, so it remains unsupported. Do not bypass those checks; supporting such a build requires locating and validating new hook offsets/signatures, then rerunning the probe.

## Target track was not confirmed playing

Soggfy requested the track but Spotify did not report the requested URI before the confirmation timeout. Common causes include login/session problems, playback startup races, ads, or a broken capture instance.

Try `soggfy auth status`, restart the daemon, and retry. The runtime periodically re-requests playback during confirmation; it does not fall back to capturing whatever happens to be playing.

## Capture never starts or finalization times out

Check daemon/payload logs. The Ogg writer is elected per capture generation across injected Spotify processes; only the elected writer may produce media. A missing writer, failed hook validation, or lost IPC/shared state prevents completion rather than allowing multiple processes to corrupt one file.

## Search says credentials are missing

Catalog search currently needs either `SPOTIFY_COOKIE` with `sp_dc=...`, or both `SPOTIFY_ACCESS_TOKEN` and `SPOTIFY_CLIENT_TOKEN`. This is separate from the native desktop login used for capture.

## Output exists but command failed

Treat the exit status as authoritative. Soggfy may have written capture/transcode bytes before validation detects truncation, decode failure, or mostly silent audio. Remove or quarantine output from failed commands.

## `raw` output fails

Raw output is not a request to dump compressed Ogg bytes. Use `ogg` to preserve the native compressed capture, or `wav`/`raw` only when the conversion path explicitly supports PCM output.

## Codesign verification fails

The payload modifies the application bundle, so the dylib and completed app must be signed after copying. Re-run setup/install rather than manually ignoring a `codesign --verify --deep --strict` failure.

## Daemon appears stale

Use:

```sh
soggfy daemon status
soggfy daemon restart
soggfy daemon logs
```

Soggfy uses recorded PIDs and descendant process trees; it does not intentionally use broad `pkill`/`killall` matching for cleanup.

## More detail

See [Known failures](../known-failures.md) for lower-level capture and runtime failure modes and [Current architecture](../current-architecture.md) for ownership, gating, validation, and process-isolation details.
