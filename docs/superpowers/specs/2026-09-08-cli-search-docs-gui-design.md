# CLI Search, Documentation, and GUI Design

## Goal

Make Soggfy easier to discover, script, and operate without duplicating product logic across the CLI and web GUI.

## Product decisions

- `soggfy download` is the canonical capture command.
- `soggfy stream` remains a compatibility alias and emits a deprecation warning to stderr.
- No `-o/--output` means media is written to stdout, preserving streaming/pipeline behavior.
- `soggfy search` searches Spotify tracks, artists, and playlists; default type is all.
- Search supports human-readable output and stable JSON output for scripts.
- Search implementation lives in shared core code and is also used by the web GUI.
- Markdown in `docs/` is the canonical documentation source for CLI help and the website.
- The documentation website is a standalone VitePress static site deployed with GitHub Pages.
- The GUI becomes search/browse + queue/library first; diagnostics remain available but collapsed by default.

## CLI command model

`download [options] <track|album|playlist>...` keeps the existing capture semantics, formats, daemon behavior, metadata tagging, multi-track naming, and stdout writer. Internal symbols and docs are renamed from stream to download; only the command alias remains legacy.

`search [options] <query...>` accepts `--type track|artist|playlist|all`, `--limit <n>`, and `--json`. Human output is compact and pipe-safe: data goes to stdout, diagnostics/errors to stderr. Results include type, display name, secondary text, URI, ID, and optional artwork URL.
## Shared Spotify search

Create `src/core/spotify-search.ts` as the only Spotify catalog-search implementation. It owns token acquisition, the current `searchDesktop` persisted query, response normalization, result filtering, and typed result models. The server's `/api/search` route calls it instead of carrying its own copy.

Search authentication remains compatible with the existing `SPOTIFY_COOKIE` path, but credential parsing/token acquisition is isolated behind a provider interface so a stronger login-derived provider can replace it without changing CLI or GUI consumers. Errors explain the required credential rather than silently returning no results.

Tests use captured/synthetic response fixtures, not live Spotify calls. A separate live smoke command verifies the current persisted query when credentials are available.

## Documentation architecture

Command and guide pages are Markdown files under `docs/cli/` and `docs/guides/`. CLI help imports the command Markdown as raw text at build time and renders a terminal-friendly subset: headings, paragraphs, lists, fenced code, inline code, and links. The same untouched files are rendered by VitePress.

Add `soggfy help [topic]` as the documentation entry point. Existing `<command> --help` paths resolve to the same Markdown documents. Top-level `--help` is generated from a small command registry so command names/descriptions cannot drift.

VitePress lives directly in `docs/.vitepress`. GitHub Pages uses `/soggfy-cli/` as the production base and a workflow with Bun, frozen lockfile install, docs build, artifact upload, and Pages deployment.

## GUI information architecture

The first viewport contains a compact product header, prominent search/download field, type filters, and search results. Results distinguish tracks, artists, and playlists; downloadable results expose one-click queue actions while artists link/search further rather than pretending they are directly downloadable.

Below that, the main workspace has queue and library/history views with status filtering, clearer progress, bulk completed download, retry/cancel actions, and the existing player. Operational health becomes a small status control that opens a diagnostics panel containing instance state, sockets, logs, and validation details.

The redesign stays inside the current React/Tailwind/shadcn visual system. `App.tsx` is split into focused components rather than restyled as an unrelated application.

## Testing and verification

- Unit-test command routing and argument parsing before implementation.
- Unit-test Markdown rendering and topic resolution.
- Unit-test Spotify response normalization for tracks, artists, playlists, filtering, limit handling, and malformed responses.
- Server tests prove `/api/search` uses the shared result shape.
- Frontend tests cover search type filtering, queue actions, queue/library filtering, and diagnostics disclosure where practical.
- Run root tests/typecheck, native fixture, CLI bundle build, webapp tests/typecheck/build, docs build, and `git diff --check`.
- Smoke `soggfy download --help`, `soggfy stream --help`, stdout capture argument behavior, and `soggfy search --help` from the built CLI.
- Preview the VitePress output locally and exercise the GUI in a browser at desktop and narrow widths.

## Constraints

- Keep Spotify 1.2.98.301 arm64 capture compatibility unchanged.
- Do not alter native capture ownership/gating semantics.
- Do not introduce broad process cleanup.
- Keep binary media on stdout completely free of status/help/deprecation output.
- Preserve existing download formats and daemon behavior.
- Keep `stream` compatibility without making it the documented primary command.
- No duplicated command help strings when a Markdown topic exists.
- No second search implementation in the webapp.
- GitHub Pages deployment must not require the Soggfy server.

## Out of scope

No artist-discography browser, playlist editing, Spotify account OAuth application registration, capture-backend changes, or native Spotify-version expansion is part of this milestone.