# `soggfy compat`

Developer workflow for validating the current Soggfy patch against another Spotify macOS build without weakening normal production version checks.

## Usage

```sh
soggfy compat list [--json]
soggfy compat probe [app-path] [--track <track>] [--record] [--keep] [--json]
```

`app-path` defaults to `/Applications/Spotify.app`. The default smoke track is `0lsvPqWmOrmqxORWrRiU52`.

## `compat list`

Shows every exact recorded build and the observed min/max supported span. Unrecorded versions remain unsupported even when their version number falls inside that span.

```sh
soggfy compat list
soggfy compat list --json
```

## `compat probe`

The probe clones the candidate into an isolated run directory, applies the current patch unchanged, signs it, launches it with the production version whitelist bypassed only for that candidate process, checks native hook readiness, performs a real validated capture, and verifies that the candidate remains faceless/headless.

Options:

- `--track <track>` — override the smoke-test track with a Spotify track ID, URI, or URL.
- `--record` — write the exact probe result into `compatibility/spotify-versions.json`.
- `--keep` — preserve the isolated run directory for inspection.
- `--json` — emit structured machine-readable output.

Without `--record`, probing never changes the tracked compatibility registry. Failed probes may be recorded for history, but only an all-green probe can produce `status: "supported"`.

The probe does not discover or guess new native offsets/prologues. If the current decoder/Ogg hooks fail their existing prologue checks, the candidate is incompatible with the current implementation and requires separate reverse engineering.
