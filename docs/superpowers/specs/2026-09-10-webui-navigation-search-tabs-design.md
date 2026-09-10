# Web UI Navigation and Search Tabs Design

## Goal

Turn the current vertically stacked Soggfy dashboard into a desktop-style music workspace that uses the full available viewport, separates major workflows into pages, and keeps Spotify search result types distinct.

## User-facing structure

The persistent left sidebar becomes real application navigation rather than anchor links. It exposes four primary pages:

- Search
- Queue
- Downloads
- Diagnostics

The player bar remains persistent across page changes when a job is selected for playback. Page changes must not interrupt polling, active captures, queued jobs, or player state.

On narrow screens, the same destinations are available from a compact mobile navigation control rather than relying on hash-anchor scrolling.

## Workspace layout

The main content area fills all width remaining beside the sidebar and all usable viewport height above the player. Remove the current `max-w-6xl` constraint and stacked-dashboard composition.

Pages may use their own internal max widths only when readability benefits from it; result tables, queues, downloads, playlists, and diagnostics should normally use the full workspace width.

The application should feel like a desktop music browser rather than a collection of dashboard cards.

## Search page

Search is the default page. A prominent search field stays at the top with support for free-text Spotify search and pasted Spotify track, album, or playlist URLs/URIs.

Search results are never mixed in one list. There is no `All` tab. The result tabs are exactly:

1. Tracks
2. Albums
3. Playlists
4. Artists

The active tab determines which result type is requested from the backend. Tabs should load lazily so a normal search does not require four full Spotify requests up front. Switching to an unloaded tab triggers its request; returning to an already loaded tab reuses cached results for the current query.

Each category should initially request substantially more than the current default: target 40 results per page, with explicit Load more or pagination using offset/limit. The UI must preserve already loaded results when loading the next page.

A new search invalidates the prior query's per-tab result cache and starts on Tracks unless the submitted input is a direct album/playlist/track target.

## Result presentation

Tracks use dense music-library rows that prioritize scanning many results: artwork, title, artist, duration when available, and direct Play and Queue actions. Rows should consume noticeably less vertical space than the current generic mixed-result rows.

Albums use an artwork grid with album title and artist. Selecting an album opens an in-app album detail view rather than immediately queueing the whole album. The detail view shows album metadata and its track list with per-track Play/Queue actions plus an explicit Queue all action.

Playlists use an artwork grid with playlist title and owner. Selecting a playlist opens the existing playlist-detail concept as an in-app detail view with its paginated track list and existing per-track/Queue all behavior.

Artists use a separate grid or compact visual list. Artist results are not interleaved with tracks, albums, or playlists. Opening an artist uses Spotify externally in this implementation; artist-detail browsing remains a non-goal.

Album and playlist detail views retain the global search field, sidebar, and player, and include an obvious Back to results action that restores the previous result tab and scroll position.
## Queue page

Queue becomes a dedicated full-width page. It shows all non-terminal jobs in a dense list/table with artwork, title, artist, state, capture progress, captured/expected bytes when meaningful, assigned instance, and cancel action.

The page should make active versus waiting work visually obvious without splitting the queue into tiny cards. Existing priority-play interruption semantics remain unchanged.

## Downloads page

Downloads becomes a dedicated full-width library/history page. It shows completed downloads and failed/cancelled attempts in a scrollable table/list that can use the full viewport height.

Completed rows expose Play and Save actions and show useful metadata such as title, artist, duration, file size, and completion state. Failed/cancelled rows retain Retry and error details. `ZIP all` remains available when applicable.

The current artificial `max-h-[420px]` history limit is removed.

## Diagnostics page

Diagnostics moves entirely off the normal music-browsing page. It gets a dedicated full-width page with health/instance summaries first and the searchable source-selectable log viewer using the remaining viewport space.

Normal Search, Queue, and Downloads pages should not reserve vertical space for diagnostics.

## Search backend/API changes

Extend `SpotifySearchType` to `track | album | artist | playlist` and normalize album results from Spotify's `searchDesktop` response rather than returning an always-empty `albums` section.

`GET /api/search` accepts:

- `q`: required query
- `type`: one result category; the redesigned UI does not request `all`
- `limit`: clamped server-side, default 40 for the web UI
- `offset`: non-negative pagination offset

The response should include the requested category's items plus enough pagination metadata for the client to determine whether Load more is available. Do not fetch and discard unrelated result types just to populate a selected tab if Spotify's query contract permits category filtering.

Add an album-detail path that resolves album metadata and paginated tracks. Reuse existing track metadata/play/queue operations instead of creating a second download pipeline. Playlist endpoints remain compatible with the existing UI and CLI behavior.

Direct Spotify inputs keep their shortcuts: track input opens/plays the track workflow, playlist input opens playlist detail, and album input opens album detail rather than immediately queueing the complete album.

## Navigation and state model

Use client-side application state plus URL hash routes for the four top-level pages and search-result/detail state. Do not add a router dependency. Page/tab/detail transitions update the hash so browser Back/Forward restores the prior workspace view.

Search query, selected result tab, loaded result pages, opened album/playlist detail, queue/library polling state, and active player job must remain independent. Navigating away from Search must not destroy the current search results.

Opening a Queue or Downloads row in the persistent player must not switch pages automatically.

## Responsive behavior

Desktop/tablet layouts should maximize information density and use available width. At smaller widths, tables may collapse secondary columns into row metadata, but search result categories must remain separate tabs and primary actions must remain directly reachable.

The persistent player must not cover the last visible rows; page containers reserve only the player height actually needed.

## Non-goals

This redesign does not change native capture behavior, daemon ownership, Spotify authentication, download semantics, or output formats. It does not add artist-detail browsing, recommendation algorithms, or a second music source. It does not replace the existing dark Soggfy visual identity with a new design system.

## Acceptance criteria

- Sidebar navigation switches between Search, Queue, Downloads, and Diagnostics pages without anchor scrolling.
- Main workspace is no longer constrained to `max-w-6xl` and uses available viewport width/height.
- Search has exactly Tracks, Albums, Playlists, and Artists tabs; there is no mixed `All` result list.
- Each selected search category returns 40 results initially and can load additional pages.
- Search results remain cached when switching tabs for the same query.
- Albums are real Spotify search results and open an in-app album track view.
- Playlists open the existing in-app playlist track view.
- Queue and Downloads each get dedicated full-height pages.
- Diagnostics gets a dedicated full-height page and no longer occupies normal browsing space.
- Existing play, queue, retry, cancel, playlist queue-all, file download, polling, and persistent player behavior continue to work.
- Direct track/playlist/album inputs resolve into the corresponding in-app workflow.
- Webapp typecheck, component/model tests, server search tests, production web build, and bundled-runtime smoke all pass.

## Verification strategy

Add model tests for page navigation state, per-query/per-tab result caching and pagination merging. Add Spotify search normalization tests for albums and type-specific pagination. Add source/component tests for the four search tabs and full-page navigation, then exercise the built web UI against the daemon with real searches for each result type and at least one album and playlist detail flow.