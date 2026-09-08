# Live Playback, Playlist Inspection, and Queue Control

Date: 2026-09-08
Status: approved design

## Goal

Extend the Soggfy web UI so users can start listening to a track while its Ogg capture is still growing, inspect playlists without implicitly downloading them, and explicitly queue either one playlist track or the whole playlist.

## Approved behavior

- Track rows expose separate **Play** and **Queue** actions.
- **Play** gives the selected track immediate capture priority and starts browser playback from the growing captured Ogg file as soon as enough bytes exist.
- If another track is actively capturing, it is interrupted. Its partial capture is discarded and the job is automatically requeued from the beginning after the priority-play track.
- Pausing or closing the browser player does not cancel the selected track's download; capture continues until completion unless explicitly cancelled.
- While a track is incomplete, seeking is limited to already-captured media. After completion, normal full-file seeking is available.
- Entering a playlist URL, Spotify playlist URI, or playlist ID opens playlist contents and queues nothing automatically.
- Playlist details expose **Queue all** plus per-track **Play** and **Queue** controls.

## Architecture

### 1. Playback-priority scheduler

The existing single Spotify capture instance remains authoritative. Add an explicit priority-play path rather than introducing a second Spotify instance.

When a play request arrives for track B while track A is capturing:

1. Mark A as interrupted-for-priority, not cancelled-by-user.
2. Stop/gate A and discard its incomplete capture artifacts.
3. Return A to the front of the normal pending queue, behind B.
4. Start B immediately as the active capture.
5. Expose B to the live stream endpoint as soon as its Ogg file exists and contains usable data.
6. When B finishes, normal queue dispatch resumes and A restarts from byte zero.

This keeps one capture owner and avoids pretending raw Ogg capture can resume safely across Spotify playback switches.

### 2. Growing Ogg HTTP stream

Replace the current `/api/stream` behavior for active jobs with a response that can remain open while the capture file grows.

The stream endpoint waits briefly for the target capture file, sends existing bytes, then tails appended bytes until the job completes, fails, is cancelled, or the client disconnects. Completed files continue to use normal range responses.

The live response must:

- use `audio/ogg`;
- stop promptly on disconnect;
- avoid busy-loop polling;
- tolerate the capture file appearing after the HTTP request starts;
- never expose stale partial data from a previously interrupted attempt;
- finish cleanly when the job becomes terminal.

A small initial buffering threshold may be used before returning audio bytes if browser decoding is unreliable with extremely short Ogg prefixes. This threshold should be measured in tests rather than guessed large enough to make playback feel delayed.

### 3. Playlist resolver

Add a Spotify playlist-detail client using the same authenticated Pathfinder transport as search. Use the observed `fetchPlaylist` persisted query and paginate by `offset`, `limit`, and `totalCount`.

The normalized playlist model contains:

- playlist id, URI, name, owner, description, artwork and total track count;
- ordered track entries with id, URI, name, artists, artwork, duration and playability.

The API supports page retrieval for the UI in pages of up to 100 tracks and a server-side full-resolution path for **Queue all**. The latter must continue paging until all available tracks are collected rather than depending on which pages the browser has loaded.

### 4. Input resolution

Spotify URLs and URIs are resolved by entity type before any queue mutation.

- Track search results expose explicit Play and Queue actions; directly submitting a track URL/URI/ID preserves the existing behavior of queueing that track.
- Playlist input: load playlist detail only; do not queue.
- Album URL/URI input preserves the existing behavior of resolving and queueing its tracks.
- Bare 22-character IDs are ambiguous. Attempt playlist resolution first; if Spotify does not resolve it as a playlist, preserve the existing track-ID behavior.

No playlist discovery request may have the side effect of creating a download job.

## API changes

Introduce explicit operations instead of overloading `/api/download`:

- `GET /api/playlist?id=<playlist>` — normalized playlist metadata and one page of tracks; accepts offset/limit.
- `POST /api/playlist/queue-all` — resolves the complete playlist server-side and queues all playable tracks.
- `POST /api/play` — requests immediate priority playback/capture for one track and returns the selected job plus interruption information.
- `POST /api/download` — remains the explicit queue/download path for individual tracks and existing non-playlist inputs.
- `GET /api/stream?track=<id>` — completed track: range-capable file response; active track: growing Ogg stream.

API failures use explicit non-2xx responses with JSON errors. Playlist resolution must distinguish not-found/invalid input from Spotify authentication/upstream failures.

## Web UI

### Search and playlist detail

Submitting a playlist input replaces generic search results with a playlist detail surface rather than adding jobs. The view shows playlist metadata followed by an ordered, progressively loaded track list.

Each playable track row has:

- **Play** — priority capture + immediate live playback;
- **Queue** — ordinary download queue insertion;
- visible state if the track is already queued, active, completed, or currently playing.

The playlist header has **Queue all** with disabled/loading/completed feedback and a count of resolved playable tracks. Large playlists load additional UI pages progressively; Queue all is independent of UI pagination.

Search-result playlist rows open the same playlist detail surface rather than queueing the playlist directly.

### PlayerBar

PlayerBar accepts active as well as completed jobs. Its status distinguishes `Buffering`, `Playing · downloading`, `Paused · downloading`, and `Downloaded`.

The player opens immediately after a successful `/api/play` request. It retries/reattaches to `/api/stream` while the capture file is being created, but surfaces a real error if playable bytes have not arrived within 20 seconds. Browser pause only controls the HTML audio element; it does not pause Spotify capture.

For incomplete downloads, the UI must not imply that uncaptured positions are seekable. If the browser exposes a buffered time range, scrubbing is capped to that range; otherwise scrubbing stays disabled until completion. Once completion is observed, reload or transition to the completed range-capable stream so normal seeking works.

## Scheduler semantics and edge cases

Priority play does not create duplicate work:

- If the requested track is completed, play the completed file immediately and do not interrupt capture.
- If it is already the active capture, attach PlayerBar to that job and live stream without restarting it.
- If it is waiting in the queue, remove that queue entry and promote the same job to immediate priority.
- If its latest job failed or was cancelled, create a replacement job.
- If another job is active, interrupt that job as a scheduler event, delete its partial capture, return it to `queued`, and place it immediately behind the priority job.

A priority interruption is not counted as a normal capture failure and must not consume `MAX_ATTEMPTS`. The interrupted job keeps its identity where practical so UI history does not show a fake failure/retry pair.

Repeated Play requests are last-request-wins. If B interrupted A and C is then played while B is capturing, C becomes priority; B is requeued ahead of A. This yields `C → B → A → previous normal queue`.

Queue insertion remains deduplicated through the job registry. Queue-all should report how many tracks were newly queued versus already present/completed.

## Error handling

- A playlist page that fails does not queue any tracks implicitly.
- Queue-all either returns explicit per-track outcomes or a clear aggregate error; it must never silently drop malformed/unplayable entries.
- If live playback cannot attach within 20 seconds, the download continues and PlayerBar reports playback failure without cancelling capture.
- If the active capture fails while being live-streamed, close the stream and surface the job error.
- Client disconnects from `/api/stream` never cancel the underlying capture.

## Testing strategy

Implement test-first at each boundary.

Server/unit coverage:

- playlist URL/URI/bare-ID resolution does not create jobs;
- Pathfinder playlist response normalization, pagination, total-count handling, unavailable/non-track entries and ordering;
- Queue all resolves every page and deduplicates existing jobs;
- priority scheduler promotes queued jobs and requeues interrupted active jobs without consuming retry attempts;
- same-track and completed-track Play requests avoid unnecessary interruption;
- repeated priority requests preserve last-request-wins ordering;
- growing-file stream emits existing and appended bytes, waits for delayed file creation, stops at terminal state and aborts cleanly on client disconnect;
- completed `/api/stream` retains range semantics.

Frontend/model coverage:

- playlist input opens detail without queueing;
- playlist rows expose Play and Queue actions and Queue all is explicit;
- PlayerBar accepts active jobs and exposes buffering/downloading/completed states;
- incomplete-track seeking is constrained to captured media.

Rendered QA must exercise desktop and a mobile viewport against the running daemon, including one live active capture where audio begins before the job reaches `completed`.

## Non-goals

- True byte-perfect pause/resume of a partially captured Spotify Ogg across track switches.
- Multiple concurrent Spotify capture instances for playback.
- Pausing server-side capture when the browser audio element is paused.
- Redesigning unrelated search, diagnostics, lyrics, or download-format behavior.

## Success criteria

1. Clicking Play on a track starts browser audio from its growing Ogg capture before download completion under normal local conditions.
2. Playing a different track interrupts the active capture immediately, promotes the requested track, and automatically restarts the interrupted job afterward from byte zero.
3. Playlist URL/URI/ID submission displays playlist contents without creating download jobs.
4. Playlist Queue all and per-track Queue actions create only the explicitly requested jobs; per-track Play uses priority playback.
5. Playlists larger than one Spotify API page are fully resolvable and maintain source order.
6. Existing CLI/download behavior, daemon ownership, completed-file download/range playback, and release-bundle behavior remain regression-clean.
7. Typechecks, unit/integration tests, production web build, and rendered desktop/mobile QA pass before completion.

## Expected implementation surfaces

Primary files are expected to include `webapp/src/index.ts`, a focused Spotify playlist client under `src/core/`, job/scheduler logic under the web server modules, `App.tsx`, `SearchPanel.tsx`, `PlayerBar.tsx`, workspace models/tests, and server tests. Native payload changes are not expected for the approved fallback architecture unless live-stream validation proves a small native correction is unavoidable.
