# `soggfy compat`

Developer workflow for validating the current Soggfy patch against another Spotify macOS build without weakening normal production version checks.

## Usage

```sh
soggfy compat list [--json]
soggfy compat fixture <captured-audio> [--track <track>] [--output <path>] [--json]
soggfy compat probe [app-path] [--track <track>] [--fixture <path>] [--record] [--keep] [--json]
```

`app-path` defaults to `/Applications/Spotify.app`. The default smoke track is `4PTG3Z6ehGkBFwjybzWkR8`. Compatibility is proven against a whole-track fixture, so the candidate must reproduce both the exact captured file and the complete canonically decoded audio.

## `compat list`

Shows every exact recorded build and the observed min/max supported span. Unrecorded versions remain unsupported even when their version number falls inside that span.

```sh
soggfy compat list
soggfy compat list --json
```


## `compat fixture`

Creates the reference manifest used by end-to-end compatibility probes. The manifest records the byte count and SHA-256 of the complete captured file plus the byte count and SHA-256 of the entire audio decoded through FFmpeg as 44.1 kHz stereo signed 16-bit PCM. No audio bytes are stored in the repository.

```sh
soggfy compat fixture capture.ogg --track 4PTG3Z6ehGkBFwjybzWkR8
```

Create fixtures only from a separately established known-good capture. A probe never updates its own fixture.

## `compat probe`

The probe clones the candidate into an isolated run directory, applies the current patch unchanged, signs it, launches it with the production version whitelist bypassed only for that candidate process, checks native hook readiness, performs a real validated capture, verifies exact whole-track fixture equality, and verifies that the candidate remains faceless/headless.

Options:

- `--track <track>` — override the smoke-test track with a Spotify track ID, URI, or URL.
- `--fixture <path>` — override the default whole-track fixture manifest for the selected track.
- `--record` — write the exact probe result into `compatibility/spotify-versions.json`.
- `--keep` — preserve the isolated run directory for inspection.
- `--json` — emit structured machine-readable output.

Without `--record`, probing never changes the tracked compatibility registry. Failed probes may be recorded for history, but only an all-green probe can produce `status: "supported"`.

The probe does not discover or guess new native offsets/prologues. Native hook targets select an implementation family separately from exact per-build addresses, so multiple versions may share one validated implementation when their ABI/behavior is identical. If hook validation or whole-track equality fails, the candidate remains unsupported until a separate implementation path or deliberate reverse engineering is validated.
