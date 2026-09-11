# Web UI Navigation and Search Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stacked Soggfy dashboard with a full-viewport multi-page music workspace and category-specific Spotify search tabs with real album support and pagination.

**Architecture:** Keep one React application and the existing server/runtime. Add small pure state helpers for page navigation and per-query search-tab caching, extend the Spotify search backend with album normalization and paginated type-specific responses, add an album-detail endpoint, then compose dedicated Search, Queue, Downloads, and Diagnostics pages around the persistent player.

**Tech Stack:** React 19, TypeScript, Bun, Tailwind CSS, existing shadcn primitives, Spotify Pathfinder web API, Bun test.

**Spec:** `docs/superpowers/specs/2026-09-10-webui-navigation-search-tabs-design.md`

## Global Constraints

- Exactly four search tabs: Tracks, Albums, Playlists, Artists; no mixed All tab.
- Initial selected-category search target is 40 results, with offset/limit pagination.
- Search tab data is lazy-loaded and cached per current query.
- Search, Queue, Downloads, and Diagnostics are separate pages using available viewport width/height.
- Persistent player and existing polling/capture/download semantics must remain unchanged.
- Native capture, daemon ownership, auth, and output formats are out of scope.
- Implement on `main`; preserve clean conventional commits per task.

---

### Task 1: Type-specific Spotify search with albums and pagination

**Files:**
- Modify: `src/core/spotify-search.ts`
- Modify: `webapp/src/server/routes.ts`
- Test: `test/spotify-search.test.ts`
- Test: `webapp/src/server/__tests__/routes-search.test.ts`

**Interfaces:**
- Extend `SpotifySearchType` with `album`.
- `searchSpotify(query, { types, limit, offset })` continues returning normalized `SpotifySearchResult[]`.
- `GET /api/search?q=<q>&type=<track|album|playlist|artist>&limit=<n>&offset=<n>` returns `{ type, items, offset, limit, nextOffset }`.

- [ ] Add failing normalization tests for album ID, name, artist subtitle, artwork, and URI.
- [ ] Add failing route tests for required type, 40-result default limit, clamping, offset, and pagination metadata.
- [ ] Run focused tests and confirm RED.
- [ ] Implement album normalization and type-specific API parsing with no mixed result response.
- [ ] Run focused tests, root/web typechecks, and confirm GREEN.
- [ ] Commit `feat: add paginated typed Spotify search`.

### Task 2: Album detail API

**Files:**
- Create: `src/core/spotify-album.ts`
- Modify: `webapp/src/server/routes.ts`
- Modify: `webapp/src/components/soggfy/models.ts`
- Test: `test/spotify-album.test.ts`
- Test: `webapp/src/server/__tests__/routes-album.test.ts`

**Interfaces:**
- `fetchSpotifyAlbumPage(albumId, { offset, limit })` returns album metadata, normalized tracks, total count, and `nextOffset`.
- `GET /api/album?id=<id>&offset=<n>&limit=<n>` mirrors playlist-detail pagination semantics.

- [ ] Write failing normalization/pagination tests using representative Pathfinder album payloads.
- [ ] Write failing route tests for invalid IDs and successful album pages.
- [ ] Confirm RED, implement the album module and route, then confirm GREEN.
- [ ] Run typechecks and commit `feat: add Spotify album detail API`.

### Task 3: Navigation and search-session state model

**Files:**
- Modify: `webapp/src/components/soggfy/workspace-model.ts`
- Test: `webapp/src/components/soggfy/__tests__/workspace-model.test.ts`

**Interfaces:**
- Add `WorkspacePage = "search" | "queue" | "downloads" | "diagnostics"`.
- Add `SearchTab = "track" | "album" | "playlist" | "artist"`.
- Add pure helpers for hash/page conversion, creating a search session, merging a tab page without duplicates, and checking whether a tab needs loading.

- [ ] Write failing tests for page/hash mapping, default Tracks tab, per-query cache reset, lazy tab state, and pagination merging.
- [ ] Confirm RED, implement minimal pure helpers, then confirm GREEN.
- [ ] Run web typecheck and commit `feat: add web workspace navigation state`.

### Task 4: Full-page Search with distinct result tabs

**Files:**
- Rewrite: `webapp/src/components/soggfy/SearchPanel.tsx`
- Create: `webapp/src/components/soggfy/SearchResults.tsx`
- Modify: `webapp/src/App.tsx`
- Modify: `webapp/src/components/soggfy/models.ts`
- Test: `webapp/src/components/soggfy/__tests__/playlist-ui-source.test.ts`
- Create: `webapp/src/components/soggfy/__tests__/search-page-source.test.ts`

**Interfaces:**
- Search page owns exactly four tabs and receives category-specific cached results/loading state from `App`.
- `onLoadTab(tab)` lazily loads the selected category; `onLoadMore(tab)` appends the next page.
- Track rows retain Play/Queue; album/playlist cards open in-app detail; artist cards open Spotify externally.

- [ ] Add source/model tests asserting four tabs, no All tab, dense track result view, 40-result requests, and Load more behavior.
- [ ] Confirm RED before component changes.
- [ ] Implement full-width Search page and per-tab rendering; remove the generic mixed-result filter.
- [ ] Wire `App` search-session caching and lazy requests without destroying state when navigating away.
- [ ] Run component tests, web typecheck/build, then commit `feat: redesign search workspace`.

### Task 5: Album and playlist in-app detail navigation

**Files:**
- Create: `webapp/src/components/soggfy/AlbumPanel.tsx`
- Modify: `webapp/src/components/soggfy/PlaylistPanel.tsx`
- Modify: `webapp/src/App.tsx`
- Test: `webapp/src/components/soggfy/__tests__/playlist-ui-source.test.ts`
- Create: `webapp/src/components/soggfy/__tests__/album-ui-source.test.ts`

**Interfaces:**
- Search detail state is either album detail, playlist detail, or none.
- Both detail views expose Back to results and preserve active search tab/results.
- Album tracks reuse `playTrack` and `queueTrack`; Queue all queues individual album track URIs through the existing download pipeline.

- [ ] Add failing source/model tests for album detail, Back to results, pagination, per-track actions, and explicit Queue all.
- [ ] Confirm RED and implement AlbumPanel plus shared detail-state wiring.
- [ ] Ensure playlist detail gains the same navigation behavior without changing its server semantics.
- [ ] Run web tests/typecheck/build and commit `feat: add album and playlist detail views`.

### Task 6: Dedicated Queue, Downloads, and Diagnostics pages

**Files:**
- Rewrite: `webapp/src/components/soggfy/JobWorkspace.tsx`
- Modify: `webapp/src/components/soggfy/DiagnosticsPanel.tsx`
- Modify: `webapp/src/components/soggfy/AppSidebar.tsx`
- Modify: `webapp/src/App.tsx`
- Create: `webapp/src/components/soggfy/__tests__/navigation-ui-source.test.ts`

**Interfaces:**
- `AppSidebar` receives active page and `onNavigate(page)` rather than hash-only links.
- Queue and Downloads render as independent full-height page components/lists.
- Diagnostics consumes the full page and no longer renders beneath normal content.

- [ ] Write failing source tests for four primary pages, active navigation, removal of anchor-scroll layout, no `max-w-6xl`, and no 420 px downloads cap.
- [ ] Confirm RED.
- [ ] Implement desktop sidebar and compact mobile page navigation.
- [ ] Split queue/download presentation into full-width page sections while preserving existing actions.
- [ ] Make Diagnostics a dedicated page with log viewer using remaining height.
- [ ] Run web tests/typecheck/build and commit `feat: add full-page web workspace navigation`.

### Task 7: Responsive polish, live verification, and release gate

**Files:**
- Modify as needed: `webapp/src/App.tsx`, Soggfy page components, related tests/docs
- Modify: `HANDOVER.md` or relevant progress documentation with verified state

**Interfaces:**
- No new product interfaces; this task verifies and tightens the completed workspace.

- [ ] Run the complete webapp test suite and fix any regressions TDD-first.
- [ ] Run root tests, both typechecks, web production build, release build, bundled-runtime smoke, docs build, shell syntax, and `git diff --check`.
- [ ] Restart the daemon and manually exercise the built web UI/API: search each of Tracks/Albums/Playlists/Artists, verify at least 40 initial items when Spotify supplies them, load another page, open one album and one playlist, play/queue tracks, navigate Queue/Downloads/Diagnostics, and verify player persistence.
- [ ] Inspect the rendered UI at desktop and narrow widths for wasted space, clipped rows, player overlap, and accidental mixed result types; fix concrete defects and rerun affected tests.
- [ ] Run final code review on the complete delta; address valid high-impact findings and rerun the gate.
- [ ] Commit final polish/docs if needed, push `main`, verify remote SHA and GitHub Actions.

## Execution notes

Tasks are intentionally ordered because backend result shapes feed the state model, which feeds the page components. Do not parallelize Tasks 1–4 against incompatible intermediate interfaces.

The existing native playback/capture implementation is not part of this plan. If unrelated native review findings remain, keep them out of UI commits unless they block the web build or live verification.

Prefer dense reusable presentation helpers over duplicating track-row behavior between Search, Album, Playlist, Queue, and Downloads, but do not create a generic component abstraction until at least two concrete views need the same behavior.