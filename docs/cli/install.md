# `soggfy install`

Prepare the local dependencies, supported Spotify app, patched workspace bundle, and capture payload.

## Usage

```sh
soggfy install [--skip-spotify-install] [--rebuild]
```

## What it verifies

1. Homebrew and required command-line dependencies (`cmake`, `ffmpeg`, `chromaprint`, `codesign`).
2. `/Applications/Spotify.app` exists and is the supported capture build.
3. A private patched Spotify workspace is recreated under `~/.soggfy`.
4. Required binaries are ad-hoc signed.
5. `libsoggfy.dylib` is reused or rebuilt.
6. The payload is installed, the completed app bundle is re-signed, and strict deep signature verification passes.

## Spotify version

The native private hooks currently support the exact arm64 builds recorded as `supported` in `compatibility/spotify-versions.json` (currently Spotify **1.2.98.301**, **1.2.99.317**, and **1.3.0.277**). Installation fails closed on any other version instead of guessing offsets.

## Options

- `--skip-spotify-install` refuses to install Spotify automatically if it is missing.
- `--rebuild` forces a fresh native payload build instead of using the bundled dylib.

After installation, run `soggfy auth login`, then optionally `soggfy daemon start`.
