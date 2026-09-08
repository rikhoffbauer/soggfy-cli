# Spotify Version Compatibility Design

## Goal

Add an independent developer workflow for applying the current Soggfy patch to a candidate Spotify macOS build, testing whether the current implementation still works unchanged, and recording exact compatibility results.

This feature is unrelated to Spotify lyrics and must not share feature-specific code with it.

## Safety model

Production runtime remains fail-closed. A normal `soggfy install`, daemon launch, temporary download instance, or doctor check may use only Spotify versions explicitly recorded as `supported` in the tracked compatibility registry.

The compatibility probe may bypass that TypeScript version whitelist only for its isolated candidate process. Native prologue validation remains enabled, and a version is not supported until native hook readiness and a real validated capture both pass.

No command automatically guesses new offsets, signatures, or prologues. A candidate that needs reverse engineering is recorded as incompatible with the current implementation.

## CLI

```text
soggfy compat probe [app-path] [--track <track-id>] [--record] [--keep] [--json]
soggfy compat list [--json]
```

`app-path` defaults to `/Applications/Spotify.app`. The probe uses a stable known Spotify track by default and accepts an override for reproducibility if that track disappears. The default should be long enough that normal Ogg/container timing variance does not dominate duration validation.
## Compatibility registry

The canonical tracked registry is `compatibility/spotify-versions.json`.

Each entry records:

- exact Spotify `CFBundleShortVersionString`;
- architecture (`arm64`);
- status: `supported` or `failed`;
- validation timestamp and Soggfy git commit;
- individual checks for patching, signing, process launch, IPC, decoder/Ogg hooks, target playback, capture, media validation, and faceless/headless behavior;
- optional failure reason/notes.

`compat list` reports exact supported versions and an observed min/max supported span. That span is informational only: unrecorded versions inside it remain unsupported.

The initial registry contains the already validated `1.2.98.301` build. Existing `SUPPORTED_SPOTIFY_VERSION` callers migrate to registry-backed helpers while retaining a latest-supported compatibility export where a single client version is needed.

## Candidate patching

A probe creates an isolated run directory under `~/.soggfy/compat/runs/`, clones the candidate `.app`, applies the same background-only Info.plist mutation as normal install, installs the current `libsoggfy.dylib`, and ad-hoc signs and verifies the completed bundle.

The source `/Applications/Spotify.app` and the production `$SOGGFY_HOME/workspace/PatchedSpotify.app` are never modified by a probe.

The probe builds the current native payload from this source checkout before applying it. A packaged CLI without the native source tree reports that probing requires a source checkout rather than silently reusing an unknown stale payload.
## Probe runtime

The probe launches the candidate with unique socket, save, profile, HOME, and TMPDIR paths. It may opt out of the TypeScript exact-version guard only through an explicit compatibility-only launch option; all normal `SpotifyInstance` construction keeps the guard enabled.

The native payload exposes a read-only `get_capabilities` IPC response. It reports whether immediate hooks initialized and whether both current Ogg capture hooks installed after their existing prologue checks. `ping` semantics do not change.

Probe checks run in this order:

1. read candidate version/architecture;
2. clone and apply the current patch;
3. sign and verify the candidate bundle;
4. launch the isolated candidate process;
5. require responsive IPC;
6. require decoder/Ogg hook capability readiness;
7. require the target track to be confirmed playing;
8. perform a real capture through the existing capture path;
9. require existing media validation to pass;
10. verify the candidate has no visible WindowServer windows and no normal Launch Services GUI registration.

A failed earlier check stops later destructive/expensive checks but still produces a structured result.

## Recording and production support

Without `--record`, `compat probe` is read-only with respect to the tracked registry. With `--record`, it updates or appends the exact version entry with the latest result.

Only an all-green probe may write `status: "supported"`. Failed probes may be recorded as `failed` for history. Production support checks ignore failed entries.

Registry writes are deterministic JSON with stable ordering so diffs are reviewable and commit-friendly.

## Testing

Unit tests cover registry parsing, exact-version support, numeric version ordering/span reporting, deterministic updates, probe argument parsing, and candidate launch safety defaults. Native fixture/tests cover the capability flag. Integration tests exercise a known supported build when available and verify that an unsupported candidate can be probed without weakening normal launch guards.
