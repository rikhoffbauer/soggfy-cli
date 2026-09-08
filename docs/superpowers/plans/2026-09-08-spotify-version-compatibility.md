# Spotify Version Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated `soggfy compat` workflow that applies the current patch to candidate Spotify builds, proves compatibility with native-hook and real-capture checks, and tracks exact supported versions without weakening production guards.

**Architecture:** A tracked JSON registry is the sole source of exact production-supported versions. The compatibility probe uses a temporary patched clone and an explicit compatibility-only launch option to bypass only the TypeScript whitelist; native prologue checks and media validation remain mandatory.

**Tech Stack:** Bun/TypeScript, Objective-C++ AppKit payload, CMake, macOS codesign/PlistBuddy, existing IPC/capture/media-validation code.

**Spec:** `docs/superpowers/specs/2026-09-08-spotify-version-compatibility-design.md`

## Global Constraints

- Production accepts only exact registry entries with `status: "supported"`.
- Observed min/max version span is informational and never an inclusive whitelist.
- Candidate probes never mutate `/Applications/Spotify.app` or the production patched workspace.
- No automatic hook-offset/prologue discovery.
- `SpotifyInstance` keeps version enforcement enabled by default.
- Preserve unrelated working-tree changes in daemon/plugin code and webapp retry/debug-port defaults.

---

### Task 1: Registry-backed production support

**Files:**
- Create: `compatibility/spotify-versions.json`
- Create: `src/core/spotify-compatibility.ts`
- Modify: `src/core/spotify-runtime.ts`
- Modify: `scripts/doctor.ts`
- Modify: `setup.sh`
- Test: `test/spotify-compatibility.test.ts`
- Test: `test/spotify-runtime.test.ts`
**Interfaces:**
- `SpotifyCompatibilityEntry`, `SpotifyCompatibilityRegistry`
- `isSpotifyVersionSupported(version: string): boolean`
- `supportedSpotifyVersions(): string[]`
- `supportedSpotifySpan(): { min: string; max: string } | null`
- `upsertCompatibilityEntry(registry, entry): registry`
- `SUPPORTED_SPOTIFY_VERSION` remains the numerically newest exact supported version for existing client-token metadata.

- [ ] Write failing registry tests for exact support, numeric dotted-version ordering, observed span, stable update ordering, and `1.2.98.301` bootstrap support.
- [ ] Run `bun test test/spotify-compatibility.test.ts test/spotify-runtime.test.ts` and verify RED.
- [ ] Add the registry and helpers; migrate `assertSupportedSpotifyBundle()` to exact registry lookup.
- [ ] Change doctor/setup compatibility checks to consume the same registry rather than a hard-coded single version.
- [ ] Run focused tests plus `bash -n setup.sh` and verify GREEN.
- [ ] Commit as `refactor: centralize Spotify compatibility registry`.

### Task 2: Native hook capability signal and safe candidate launch

**Files:**
- Modify: `soggfy-macos/Payload/DecodeHook.h`
- Modify: `soggfy-macos/Payload/DecodeHook.mm`
- Modify: `soggfy-macos/Payload/Main.mm`
- Modify: `src/core/instance.ts`
- Test: `test/instance-profile.test.ts`
- Test: `test/capture-safety.test.ts`
- Test: `soggfy-macos/tests/state_manager_fixture.cpp` only if native fixture coverage needs a callable symbol.

**Interfaces:**
- Native `std::atomic<bool> g_decoder_hooks_ready` is true only when both validated Ogg hooks install.
- IPC `get_capabilities` returns JSON containing `hooksInitialized`, `decoderHooksReady`, and `captureBackend`.
- `SpotifyInstanceOptions { appPath?: string; enforceSupportedVersion?: boolean }`; default enforcement is `true`.

- [ ] Write failing tests proving normal instances still enforce support and compatibility-only instances can select another app path without changing defaults.
- [ ] Add source-level/native assertions for `get_capabilities` and decoder readiness.
- [ ] Run focused tests and verify RED.
- [ ] Implement readiness flag, IPC response, and explicit instance options.
- [ ] Build native payload and run focused tests/native fixture to verify GREEN.
- [ ] Commit as `feat: expose Spotify hook compatibility status`.
### Task 3: Isolated compatibility probe and recording

**Files:**
- Create: `src/commands/compat.ts`
- Create: `src/core/compat-probe.ts`
- Modify: `src/cli.ts`
- Modify: `src/core/commands.ts`
- Modify: `src/core/help.ts`
- Create: `docs/cli/compat.md`
- Modify: `docs/cli/index.md`
- Modify: `docs/.vitepress/config.ts`
- Test: `test/compat-command.test.ts`
- Test: `test/compat-probe.test.ts`

**Interfaces:**
- `CompatProbeOptions { appPath: string; trackId: string; record: boolean; keep: boolean; json: boolean }`
- `CompatibilityProbeResult` contains version, architecture, status, run directory, git commit, timestamps, per-check booleans, and optional failure reason.
- `probeSpotifyCompatibility(options): Promise<CompatibilityProbeResult>`
- Default smoke track: `4PTG3Z6ehGkBFwjybzWkR8`.

- [ ] Write failing CLI parsing/list-output tests and pure probe-result/registry-recording tests.
- [ ] Run focused tests and verify RED.
- [ ] Implement candidate cloning, headless plist mutation, current payload build/install, ad-hoc signing, isolated `SpotifyInstance` launch with `enforceSupportedVersion: false`, `get_capabilities`, existing `captureTrack`, and cleanup/keep behavior.
- [ ] Implement `compat probe` and `compat list`, including deterministic `--record` writes.
- [ ] Wire canonical Markdown help and VitePress navigation.
- [ ] Run focused tests, typechecks, docs build, and verify GREEN.
- [ ] Commit as `feat: add Spotify compatibility probe`.

### Task 4: Live validation and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/current-architecture.md`
- Modify: `docs/guides/troubleshooting.md`
- Modify: `docs/known-failures.md`
- Modify: `compatibility/spotify-versions.json` only through recorded probe results when requested by the live outcome.

- [ ] Run `soggfy compat list --json` and verify `1.2.98.301` is exact-supported.
- [ ] Probe the existing patched/supported `1.2.98.301` app with a real validated capture and verify all checks pass.
- [ ] Probe `/Applications/Spotify.app` (currently observed as `1.2.99.317`) without modifying production state; record the actual result rather than assuming compatibility.
- [ ] Confirm a failed candidate does not become production-supported and a successful recorded candidate does.
- [ ] Document the workflow, exact-support semantics, observed-span semantics, and reverse-engineering next step for prologue mismatches.
- [ ] Run all non-concurrent tests, full builds/typechecks/docs/native fixture, and `git diff --check`.
- [ ] Run the full suite too and report any failure caused by the separately modified daemon/plugin work rather than hiding it.
- [ ] Commit as `docs: document Spotify compatibility workflow` (including registry result changes if produced by the probes).
