# HANDOVER

## Current state

`main` is based on `aa952ff` with a verified playback/capture hardening patch ready to commit. The live daemon was rebuilt/restarted on the current payload and the complete local release gate is green.

## Root causes fixed

- Spotify 1.2.98.301 playback control now uses the original Spotify-signed bundled `spotify_cli`; the old self-directed `PCtx` AppleEvent path could leave playback stuck/restarted.
- `pause` uses the same synchronous control path, eliminating a race where a delayed pause from the previous job could stop the next track.
- The payload clears `DYLD_INSERT_LIBRARIES` immediately after loading so child/system processes do not inherit the arm64 dylib (notably arm64e tools).
- Ogg capture retains gated BOS/header pages in bounded pre-roll, publishes stream selection atomically, and propagates gate generations across processes.
- Capture completion no longer treats stagnant byte growth as EOS; native completion is authoritative and playback position is monitored for genuine stalls.
- Playback confirmation requires exact target URI, playing state, and advancing position.
- Spotify CLI signing is preserved while the patched app/payload are signed and verified.
- Existing official Spotify auth migrates once into Soggfy-owned state under a process lock; explicit logout/import suppresses automatic re-import.
- Legacy daemon retirement fingerprints include Darwin kernel process birth identity to fail closed on PID reuse.

## Live E2E verification (2026-09-10)

After rebuilding the payload and restarting the daemon, fresh web `/api/play` jobs completed with native EOS and zero capture-validation warnings:

- Murder Murder (`575BKqgHeL2srecj3MfGX1`): attempt 1, 224.200 s.
- Lose Yourself (`5Z01UMMf7V1o0MzF86s6WJ`): attempt 1, 326.467 s.
- Stan (`3UmaczJpikHgJFyBTAJVoz`): attempt 1, 404.107 s.
- Till I Collapse (`4xkOaSrkexMciUUogZKVTS`): attempt 1, 297.787 s.

Independent `ffprobe` checks confirmed stereo 44.1 kHz MP3 output at those durations.

## Local verification

- `bun test`: 202 passed, 0 failed (69 files, 593 expectations).
- Root and web TypeScript checks pass.
- Native payload builds.
- StateManager, process-role, Ogg pre-roll, and DYLD child-inheritance fixtures pass.
- Web production build, release runtime build, and outside-checkout runtime smoke pass.
- Documentation build, shell syntax, and `git diff --check` pass.

## Remaining release steps

Review the complete staged delta, commit/push `main`, verify the GitHub Actions run and downloaded artifact digest/archive contents.
