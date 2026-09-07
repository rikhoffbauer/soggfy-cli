# `soggfy-cli` Review

Reviewed: 2026-09-08
Branch: `main`
Commit: `dccafa5f978664b8f7a2ca8733fa7d11aa284a4c`

## Verdict

The project has a useful prototype core and several good defensive pieces, but it is **not release-ready** in its current form. The largest risks are in the exact area the project depends on most: capture-source isolation, multi-process ownership of captured files, and packaged daemon execution.

The highest-priority problems are not cosmetic. They can cause incorrect/corrupt captures, make `SOGGFY_CAPTURE_BACKEND=disabled` write audio anyway, or make the published CLI archive fail when starting its daemon.

Recommended status: **experimental / developer-only** until the P0 findings below are fixed and covered by deterministic tests.

## Review rubric

The review evaluated:

1. Capture correctness and track isolation.
2. Process, IPC, and daemon lifecycle reliability.
3. Packaged/release behavior rather than source-tree-only behavior.
4. Build reproducibility and CI coverage.
5. Type safety, automated tests, and failure observability.
6. Security/privacy of credentials, temporary files, and debug facilities.
7. Documentation accuracy and architectural coherence.

## Verification performed

| Check | Result |
|---|---|
| `bun test` | PASS: 7 tests, 0 failures |
| `bun run build:cli` | PASS |
| `cmake --build soggfy-macos/build -j 4` | PASS |
| `scripts/run-state-manager-fixture.sh` | PASS |
| Root TypeScript check | FAIL: config/dependency issue; after forcing Bun types, `capture.ts` has a real missing import and root JSX config is incomplete |
| `webapp` build after locked dependency install | PASS |
| `webapp` typecheck after dependency install | FAIL: 15 errors in `chart.tsx` and `src/index.ts` |
| `scripts/doctor.ts` in this checkout | FAIL: patched workspace/app bundle and webapp dependencies were not installed |
| Native dylib architecture | `arm64` only |
| Lockfiles | both root and `webapp/bun.lock` are ignored by `.gitignore` |

The passing test count overstates core coverage. `test/fingerprint.test.ts:6-10` silently returns success when its hard-coded `/tmp` sample does not exist. Most other tests exercise the separate `webapp/src/server` helpers, not the root CLI/native capture path.

## P0 — must fix before release

### P0.1 — Capture backend selection is not actually enforced

**Evidence:**

- Root CLI defaults to `pcm`: `src/core/paths.ts:24`.
- `CaptureBackendAllows()` returns `true` for every PCM hook when backend is `pcm`: `soggfy-macos/Payload/Main.mm:259-273`.
- Multiple PCM hook families are installed simultaneously: AVAsset, AudioUnitRender, AudioConverter, and render callback paths in `Main.mm:1023-1147`.
- Raw Ogg capture bypasses `CaptureBackendAllows()` entirely and writes directly through `ReceiveOggData()`: `soggfy-macos/Payload/DecodeHook.mm:71-106`.

This directly contradicts `docs/current-architecture.md:7-9,70`, which says the backend defaults to disabled and prevents simultaneous hook-family writes. In practice, even the `webapp`'s `disabled` default does not prevent the raw Ogg hook from writing if that hook fires.

**Impact:** the same requested track can be sourced from multiple stages of Spotify's audio pipeline, causing duplicate/mixed bytes, premature size completion, or an unexpected `.ogg` result when `pcm` was requested. `disabled` cannot be trusted as a no-capture safety mode.

**Fix:** make capture routing a single central decision used by *every* hook. Use an explicit backend/source enum and allow exactly one writer source per process/job. The Ogg hook and the 12x decoder mutation must also obey `disabled`.

### P0.2 — Multiple injected Spotify processes can write the same track file

**Evidence:**

- Helper processes poll the shared `active_track.txt` and explicitly set `g_capture_gated=false`: `Main.mm:1152-1176`.
- The payload installs audio hooks and the watchdog in **all** injected processes: `Main.mm:1268-1274`.
- All processes inherit the same `SOGGFY_SAVE_PATH` from a `SpotifyInstance`.
- `StateManager` is process-local and opens deterministic `<trackId>.wav` / `<trackId>.ogg` paths: `StateManager.cpp:100-170`.

The main process's target/ad notification gate therefore does not govern helper writers. Two helpers can independently open/truncate/write the same output path, while the main process's `StateManager`/IPC status does not necessarily describe those writes.

**Impact:** data races, truncation, interleaving, wrong-track/ad capture, misleading status, and nondeterministic completion.

**Fix:** establish one authoritative capture owner. Prefer installing write-capable audio hooks only in the process proven to own the desired decoder, or relay captured buffers/pages to a single writer process over dedicated IPC. Never let multiple process-local `StateManager`s target the same pathname.

### P0.3 — The packaged CLI daemon re-executes a source file that is not in the release

`src/commands/daemon.ts:82-90` and `:250-260` derive `${__dirname}/../cli.ts` and run it with Bun. The bundle preserves this logic (`dist/cli.js` currently contains the same expression), but bundling moves `__dirname` to the bundle directory.

In the GitHub release layout the executable is `release-bundle/bin/soggfy`; there is no `release-bundle/cli.ts`. The source-tree path only works before bundling.

**Impact:** `soggfy daemon start` and the daemon's `/api/stream` child dispatch are broken or source-tree-dependent in the artifact CI publishes.

**Fix:** re-exec the current entrypoint instead of constructing a source path. Under Bun, use the current script (`process.argv[1]`) with `process.execPath`, and add a smoke test that extracts the exact release tarball to a temporary directory and starts/stops the daemon from there.

### P0.4 — Daemon `/api/stream` routes binary audio into the daemon log

The daemon itself is launched with stdout/stderr appended to `DAEMON_LOG` (`daemon.ts:86-93`). Its `/api/stream` endpoint then spawns `soggfy stream <track>` with both streams set to `inherit` (`daemon.ts:250-260`). A normal `stream` invocation writes audio bytes to stdout.

**Impact:** successful API streaming can append MP3/WAV/other binary data into `daemon.log`, corrupting logs and potentially consuming large amounts of disk. The endpoint also returns success immediately without tracking whether the child succeeds.

**Fix:** do not implement the daemon API by launching the stdout-oriented CLI command. Call a shared job/capture service directly. At minimum, capture child stdout separately and return/route it intentionally rather than inheriting daemon stdout.

## P1 — high priority

### P1.1 — Native hooks are tied to hard-coded Spotify addresses without compatibility checks

`DecodeHook.mm:152-178` hooks `base + 0x127fe94` and `base + 0x12b32c8`. There is no Spotify binary/version fingerprint, instruction signature validation, or checked `DobbyHook` return before those addresses are used.

A Spotify update can therefore turn a previously valid build into a crash or hook an unrelated function.

**Fix:** fingerprint supported Spotify builds, resolve targets by validated signatures/symbol context where possible, verify hook prologues before patching, check hook return codes, and fail closed with a precise unsupported-version error.

### P1.2 — PCM format assumptions are unsafe across the installed hook families

`StateManager` always writes IEEE float32, stereo, 44.1 kHz WAV headers (`StateManager.cpp:70-98`). The CoreAudio/AudioConverter hooks cast output buffers to `float*` and infer mono/interleaved/non-interleaved layout without querying the actual stream format.

`AudioConverterFillComplexBuffer` in particular treats packet output as float PCM even though the converter output format is not established. The private AVAsset decoder hook also assumes a fixed ABI/layout.

**Impact:** a hook can produce bytes that do not match the WAV header or even compressed/non-float data interpreted as floats. The file may still be non-empty and therefore appear successful to the root CLI.

**Fix:** capture and validate the actual `AudioStreamBasicDescription` associated with the selected hook. One backend should own one known format; reject rather than guess when the format cannot be proven.

### P1.3 — Root CLI accepts corrupt/truncated/silent captures as successful

`src/core/capture.ts:142-148` only requires that an output file exists and has a size. `src/core/transcode.ts:40-46` similarly treats an ffmpeg zero exit plus non-empty output as success. There is no RIFF/Ogg structural validation, expected-duration tolerance, signal sanity check, or `ffprobe` gate.

The separate `webapp/src/server/media.ts` already contains substantially better validation logic, but the root CLI does not share it.

**Fix:** move media validation into one shared module and require it before reporting completion. Validate container structure, codec/sample format, duration tolerance, ffprobe decodeability, and basic signal health. Preserve rejected captures for diagnostics with an explicit failure status.

### P1.4 — CI is green while both TypeScript trees fail typechecking

Root `tsconfig.json` references `bun-types`, while `package.json` installs `@types/bun`; a normal `tsc --noEmit` cannot resolve the configured type package. Forcing the installed Bun types exposes a real error: `src/core/capture.ts:43` uses `readFileSync` without importing it. That exception is swallowed by the surrounding empty `catch`, so the file-based track-confirmation fallback silently never works.

The root config also includes `src/web/frontend.tsx` without a JSX compiler option. After installing `webapp` dependencies from its local lockfile, its typecheck still reports 15 source errors: 13 in `src/components/ui/chart.tsx`, plus `src/index.ts:677` (`queued` possibly undefined) and `:969` (the `archiver` import is not callable under its declared types).

`.github/workflows/ci.yml` runs tests and bundles, but never runs either typecheck.

**Fix:** repair both tsconfigs/types, make `typecheck` an explicit root script, typecheck root and webapp independently in CI, and fail PRs on errors.

### P1.5 — The repository contains two divergent products with incompatible setup/state models

The root CLI uses `~/.soggfy/workspace/PatchedSpotify.app`, one daemon socket, and `src/core/*`. `setup.sh` + `webapp/src/index.ts` instead use repository-local `workspace/`, a Spotify instance pool, a separate job registry, duplicate URL/IPC/metadata logic, and separate output handling.

`README.md` describes the root CLI architecture; `docs/current-architecture.md` describes the webapp architecture. Their capture-backend defaults and validation guarantees differ.

**Impact:** fixes can land in one implementation while the other remains broken; documentation can be correct for one entrypoint and false for another; tests in one tree give confidence about code that the other entrypoint never calls.

**Fix:** choose one runtime architecture. Extract shared capture/IPC/media primitives into one package/module and make CLI + web UI thin clients of the same service. Remove the obsolete implementation once parity is reached.

### P1.6 — Builds/releases are not reproducible

`.gitignore:8` ignores every `bun.lock`, including `webapp/bun.lock`; neither lockfile is tracked. CI runs plain `bun install`, so dependency resolution can change between builds without a repository change.

Native builds are also mutable: `soggfy-macos/CMakeLists.txt:13-17` fetches Dobby from `GIT_TAG master` rather than a pinned commit.

**Fix:** commit root and webapp lockfiles, use `bun install --frozen-lockfile` in CI, pin Dobby to a reviewed commit SHA, and record the Spotify/payload compatibility tuple in release metadata. Restrict GitHub Actions `contents: write` to the release job; the build/test job only needs read access.

### P1.7 — Intel support is claimed but the payload/release is ARM64-only

`README.md:31` claims “Apple Silicon or Intel”. CMake forces `CMAKE_OSX_ARCHITECTURES "arm64"` (`CMakeLists.txt:8-9`), CI publishes `soggfy-macos-arm64.tar.gz`, and the locally built dylib is confirmed `Mach-O ... arm64`.

**Fix:** either remove the Intel claim and fail early on x86_64, or build/test a universal/x86_64 payload and provide per-architecture hook resolution. Given the hard-coded ARM64 offsets, documenting Apple Silicon-only is the realistic short-term choice.

### P1.8 — Auth import permits path traversal; auth export permissions are too loose

`src/commands/auth.ts:58-64` directly joins untrusted snapshot keys under `USERS_DIR` without rejecting `..` traversal. A crafted imported JSON file can escape that directory and overwrite other files writable by the user.

`auth export` writes credential material using default file permissions (`auth.ts:193-195`). With a typical `022` umask this is commonly `0644`, inappropriate for a portable credential snapshot.

**Fix:** validate every imported relative path with `resolve()` and require it to remain strictly under the intended root; reject absolute/traversal paths and unexpected value types. Create auth exports with mode `0600`, avoid logging sensitive details, and document that the file contains reusable account state.

### P1.9 — TLS session key logging is enabled by default

`src/core/instance.ts:78-106` sets `SSLKEYLOGFILE` to `/tmp/sslkeylog.log` and passes the equivalent Chromium flag. `Main.mm` also supplies the same fallback. This is unrelated to normal capture and leaves TLS session secrets in a predictable temporary path.

**Fix:** make TLS key logging opt-in behind a clearly named debug flag, create the file with owner-only permissions, and delete/rotate it explicitly when debugging ends.

### P1.10 — Installer reports successful signing without checking the result

`src/commands/install.ts:125-128` calls `codesign` with `Bun.spawnSync()` but ignores its exit status and immediately logs `Signed`. `setup.sh` similarly uses `codesign ... || true` for important targets.

**Impact:** installation can appear successful while the patched Spotify executable/framework is not loadable with the injected dylib; the failure then surfaces much later as a handshake timeout.

**Fix:** use the existing checked command helper for every required signing operation, run `codesign --verify --deep --strict` on the finished copied bundle, and emit the failing target/stderr directly.

## P2 — medium/cleanup findings

### P2.1 — CLI option parsing needs validation

`src/commands/stream.ts:55-69` consumes values after `-o`/`-f` without checking that a value exists, accepts arbitrary format strings via a type cast, and silently ignores unknown flags. Invalid input should fail immediately with a usage error and non-zero exit.

### P2.2 — `raw` output corrupts an Ogg capture

`captureTrack()` can return an `.ogg` path in its `wavPath` field. `transcode.ts:21-26` and `:67-75` implement `raw` by blindly removing 44 bytes as though every input were WAV. Detect the actual container first; raw PCM should only be available for proven PCM WAV input.

### P2.3 — Pattern scanner misses the final valid match position

`Scanner.cpp:79-85` loops with `n < sec->size - parsed_pattern.size()`. It should include the final legal offset (`<=`). If a section is exactly the pattern length, it currently checks nothing.

### P2.4 — Daemon readiness timeout returns success

`daemon.ts:107-129` waits up to 90 seconds for IPC. If readiness never arrives but the child process stays alive, the command only warns and returns normally. Treat readiness timeout as startup failure, terminate/recycle the failed child, and exit non-zero.

### P2.5 — Process cleanup is broader than necessary

Root daemon/instance shutdown uses `pkill -9 -f SOGGFY_SOCKET_PATH=...` (`daemon.ts:151-153`, `instance.ts:149-163`). Prefer tracking exact child PIDs/process groups. Broad command-line matching increases the chance of killing an unrelated development process using the same environment marker.

### P2.6 — Temporary output/log permissions are not intentionally constrained

`Main.mm:1207-1210` creates the capture directory with mode `0777` (subject to umask), sockets/files use predictable `/tmp` names, and all injected processes append to `/tmp/soggfy.log`. Use a user-private directory (`0700`), owner-only files where appropriate, and per-instance/per-PID logs.

### P2.7 — Native test fixture exists but is not a CI gate

`scripts/run-state-manager-fixture.sh` passes locally and is valuable, but CI only runs `bun test`. Add the fixture explicitly, then extend it to cover cancellation, Ogg/WAV separation, byte limits, invalid formats, and backend-disabled no-write behavior.

### P2.8 — Test skipping is implemented as a passing test

`test/fingerprint.test.ts:6-10` prints “Skipping” and returns. This looks green in CI even when the intended fixture is absent. Generate a deterministic audio fixture in the test or use an explicit skip mechanism with a separate required fixture test.

### P2.9 — Dependency/setup documentation is stale

The native build no longer uses Capstone, but `README.md:56`, `src/commands/install.ts:53`, and `setup.sh` still install/check `capstone` and `pkg-config`. Remove unused dependencies to reduce setup time and failure surface.

### P2.10 — Versioning has multiple unsynchronized sources

`package.json` and the CLI source both carry version information independently, while GitHub releases are tag-driven. Generate/read the CLI version from one authoritative source and verify the release tag matches it.

### P2.11 — Fast-decode mutation is not coupled to capture safety

`DecodeHook.mm:137-146` changes Spotify's reported decoded sample count to implement the 12x speed trick whenever the track is ungated. It does not consult the selected backend. A diagnostic/disabled mode should not mutate playback timing, and production capture should only enable acceleration after the chosen backend has proven it can preserve sample continuity.

### P2.12 — Output cleanup is not exception-safe

`stream.ts` deletes the intermediate capture only after successful output handling. Failed transcoding or stdout errors leave temp media behind even without `--keep-wav`. Preserve failures deliberately in a named diagnostics area or clean them in a `finally`; do not leave behavior accidental.

## What is already good

- `/Applications/Spotify.app` is copied rather than modified in place.
- IPC uses bounded retries/timeouts and readiness requires a real ping/pong handshake.
- The native `StateManager` fixture is fast and deterministic enough to become a useful regression suite.
- The webapp job registry has explicit lifecycle states instead of inferring progress from files alone.
- The webapp media module contains useful WAV validation, signal checks, ffprobe validation, fallback preservation, and sidecars.
- The native payload and root CLI both build successfully on the reviewed Apple Silicon machine.
- Release CI at least verifies native architecture/linkage and packages a concrete artifact rather than publishing source-only output.

## Recommended fix order

1. **Make capture single-writer and backend-authoritative.** Disable raw Ogg/decoder mutation when not selected; guarantee one hook family and one process owns a job's output.
2. **Fix packaged daemon execution.** Re-exec the current CLI artifact and remove stdout-to-log binary routing; add an extracted-release smoke test.
3. **Unify the runtime.** Make CLI and web UI share one capture/job/media implementation and one workspace/config model.
4. **Make media correctness a hard gate.** Reuse structural/signal/ffprobe validation everywhere and reject unverifiable captures.
5. **Turn CI into a release gate.** Add root/webapp typechecks, native fixture tests, release-artifact smoke tests, and deterministic generated audio fixtures.
6. **Make builds deterministic and compatibility-aware.** Commit Bun locks, pin Dobby, identify supported Spotify builds, and resolve/validate hooks safely.
7. **Harden credentials/debug/install behavior.** Fix auth traversal + permissions, disable TLS key logging by default, and verify every codesign operation.

## Release acceptance checklist

Do not call the project release-ready until all of the following are true:

- [ ] `SOGGFY_CAPTURE_BACKEND=disabled` produces no captured media and performs no 12x decoder mutation.
- [ ] A capture has exactly one writer PID and exactly one selected hook/backend; a test proves no duplicate/interleaved writes.
- [ ] The exact extracted CI release archive can run `install`/`daemon start`/`daemon status`/`daemon stop` without any source tree present.
- [ ] Root and webapp typechecks, unit tests, native fixtures, and builds all pass from a clean locked checkout.
- [ ] Truncated, silent, malformed, wrong-duration, or format-mismatched captures are rejected rather than reported successful.
- [ ] Native hooks refuse unsupported Spotify builds before patching unknown offsets.
- [ ] Dependency resolution is locked/pinned and the supported CPU architecture in documentation matches the produced artifact.

## Bottom line

The strongest part of the repository is the newer job/validation work in `webapp`; the weakest part is the native capture ownership model and the split between that webapp architecture and the root CLI architecture. Fixing individual symptoms in the current multi-hook/multi-process design will likely keep producing regressions. The highest-leverage change is to make **one process + one backend + one writer** an invariant, then put the CLI and web UI on top of that same implementation.
