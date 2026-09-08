# CLI Search, Documentation, and GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the canonical `download` command, Spotify catalog search, shared Markdown CLI/docs site, and a search/queue/library-first GUI.

**Architecture:** Keep capture untouched and add thin product layers around shared core modules. CLI and webapp consume one Spotify-search implementation; CLI help and VitePress consume the same Markdown files. The GUI is decomposed into feature components while retaining the existing server/job APIs.

**Tech Stack:** Bun, TypeScript, React 19, Tailwind/shadcn, VitePress, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-cli-search-docs-gui-design.md`

## Global Constraints

- Keep Spotify 1.2.98.301 arm64 capture compatibility unchanged.
- Keep binary stdout free of all diagnostic output.
- Preserve all existing formats, daemon behavior, validation, signing, and process-safety guarantees.
- `stream` is compatibility-only; `download` is canonical.
- Markdown and Spotify search each have exactly one production source of truth.
- GitHub Pages is static and independent of the Soggfy server.

---

### Task 1: Canonical download command and command registry

**Files:** rename `src/commands/stream.ts` to `src/commands/download.ts`; modify `src/cli.ts`, `src/commands/install.ts`; add `src/core/commands.ts`; add/update CLI tests.

**Interfaces:** `downloadCommand(args: string[]): Promise<void>` and `parseDownloadArgs(args)` replace stream-named symbols; router maps both `download` and deprecated `stream` to the same implementation.

- [ ] Write failing tests proving `download` routes to the capture command, `stream` remains accepted, stdout remains default without `-o`, and binary stdout never receives warnings.
- [ ] Run the focused tests and verify failures are caused by missing `download` routing/symbols.
- [ ] Rename implementation symbols/file, add command registry, route both names, and emit the alias warning only on stderr.
- [ ] Run focused tests, root tests, and typecheck.
- [ ] Commit as `feat(cli): rename stream command to download`.

### Task 2: Shared Spotify search and CLI search

**Files:** create `src/core/spotify-search.ts`, `src/commands/search.ts`; modify `src/cli.ts`, `webapp/src/index.ts`; add `test/spotify-search.test.ts`, `test/search-command.test.ts`, and server tests as needed.

**Interfaces:** `searchSpotify(query, { types, limit, fetchImpl? }): Promise<SpotifySearchResult[]>`; normalized results expose `id`, `uri`, `type`, `name`, `subtitle`, optional `imageUrl`; `searchCommand(args)` prints table/text or JSON.

- [ ] Write fixture-based failing tests for track/artist/playlist normalization, type filtering, limit clamping, malformed responses, and stable JSON shape.
- [ ] Verify RED with focused Bun tests.
- [ ] Extract token/query/search logic from webapp into shared core, map all three required result types, and make credential failures actionable.
- [ ] Implement CLI parsing for `--type`, `--limit`, `--json`, query text, terminal output, and exit codes.
- [ ] Replace webapp `/api/search` implementation with the shared function and adapt its JSON response without a second mapper.
- [ ] Run focused tests, root tests/typecheck, webapp tests/typecheck.
- [ ] Commit as `feat(search): add shared spotify catalog search`.

### Task 3: Markdown-powered CLI help and GitHub Pages documentation

**Files:** create `src/core/help.ts`, `src/commands/help.ts`, `docs/index.md`, `docs/cli/*.md`, `docs/guides/*.md`, `docs/.vitepress/config.ts`, `.github/workflows/docs.yml`; modify command help paths and `package.json`; add help tests.

**Interfaces:** `getHelpTopic(name): string | null`, `renderMarkdownForTerminal(markdown): string`, `helpCommand(args)`; command handlers call the same topic loader for `--help`.

- [ ] Write failing tests for topic lookup, Markdown-to-terminal rendering, `download --help`, `search --help`, and unknown topics.
- [ ] Verify RED.
- [ ] Add raw Markdown imports/topic registry and terminal renderer; remove duplicated long help strings from command implementations.
- [ ] Write extensive command/reference/guides Markdown and VitePress navigation/sidebar config with production base `/soggfy-cli/`.
- [ ] Add `docs:dev`, `docs:build`, `docs:preview` scripts and VitePress dependency; use a frozen Bun install in Pages workflow.
- [ ] Build CLI and docs locally; check generated pages and command help.
- [ ] Commit as `docs: add shared cli and web documentation`.

### Task 4: Search/queue/library-first GUI

**Files:** split `webapp/src/App.tsx` into focused components under `webapp/src/components/soggfy/`; modify `webapp/src/App.tsx` and `webapp/src/index.css`; add frontend tests where practical.

**Interfaces:** `SearchPanel` consumes `/api/search` normalized results and queues supported items; `JobWorkspace` owns queue/library filtering and actions; `DiagnosticsPanel` renders health/instances behind disclosure; `PlayerBar` owns completed-file playback.

- [ ] Write failing component/helper tests for search type filtering, queue/library partitioning, and diagnostics default-collapsed state.
- [ ] Verify RED.
- [ ] Extract typed frontend models and pure selectors first, then move existing rendering into focused components without changing server behavior.
- [ ] Recompose the primary screen around search results, queue, completed library/history, useful empty states, progress/actions, and a compact status/diagnostics control.
- [ ] Add responsive behavior and keyboard/focus treatment; retain the current visual system and avoid decorative dashboard clutter.
- [ ] Run frontend tests, webapp typecheck/build, and browser-smoke the search → queue → progress/library → playback path plus diagnostics.
- [ ] Commit as `feat(gui): prioritize search queue and library workflow`.

### Task 5: Full verification and Pages deployment

**Files:** update `README.md`, `REVIEW.md` only if current behavior/status references need correction; no unrelated refactors.

- [ ] Run `bun test`, `bun run typecheck`, `bun run test:native`, `bun run build:cli`, `bun run docs:build`, webapp tests/typecheck/build, `bash -n setup.sh`, and `git diff --check`.
- [ ] Smoke built CLI help, search argument validation/JSON formatting, canonical download routing, and deprecated stream alias stderr behavior.
- [ ] Run a live catalog search if credentials are available; otherwise record the credential-gated result and verify the failure message.
- [ ] Run a local docs preview and verify links/navigation at the `/soggfy-cli/` base.
- [ ] Run the web GUI locally and inspect desktop plus narrow viewport behavior and core actions.
- [ ] Push `feat/cli-docs-gui`; dispatch the Pages workflow from this branch if repository Pages permits branch workflow deployment without merging `main`; otherwise leave the workflow ready and report the repository-level blocker explicitly.
- [ ] Confirm final git status and commit any final documentation corrections as `docs: finish cli search and gui milestone`.
