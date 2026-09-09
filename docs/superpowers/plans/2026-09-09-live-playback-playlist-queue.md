# Live Playback and Playlist Queueing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play tracks from their growing Ogg capture, let priority Play interrupt and later restart the current capture, and inspect playlists without queueing until explicit per-track or Queue all actions.

**Architecture:** Keep the daemon-owned single Spotify capture instance. Add a paged Pathfinder playlist client, a small priority-aware queue abstraction around existing jobs, and a growing-file HTTP stream keyed to the exact job. The React UI separates Open/Play/Queue actions and renders playlist detail plus active PlayerBar state.

**Tech Stack:** Bun, TypeScript, React 19, Bun.serve, Spotify Pathfinder web API, existing Soggfy IPC/capture hooks, bun:test, Puppeteer Core + system Chrome for rendered QA.

**Spec:** `docs/superpowers/specs/2026-09-08-live-playback-playlist-queue-design.md`

## Global Constraints

- One Spotify capture instance remains authoritative; do not add a second playback instance.
- Live playback streams the same growing Ogg capture used for the download.
- Priority interruptions discard partial capture data and restart the interrupted job from byte zero without consuming a retry attempt.
- Playlist discovery never creates download jobs.
- Queue all resolves every playlist page server-side and preserves source order.
- Browser pause/close never pauses or cancels server-side capture.
- Preserve completed-file range serving, daemon ownership, CLI behavior, and release-bundle compatibility.
- No new runtime dependencies.

---### Task 1: Spotify playlist Pathfinder client

**Files:**
- Create: `src/core/spotify-playlist.ts`
- Create: `test/spotify-playlist.test.ts`

**Interfaces:**
- Produces: `SpotifyPlaylistTrack`, `SpotifyPlaylistPage`, `fetchSpotifyPlaylistPage(id, options)`, `fetchAllSpotifyPlaylistTracks(id, options)`.
- Consumes: `getSpotifyWebTokens()` and `SPOTIFY_WEB_USER_AGENT` from `src/core/spotify-web-auth.ts`.

- [ ] **Step 1: Write failing normalization and pagination tests**

```ts
const page = normalizeSpotifyPlaylistResponse(fixture, 0, 2);
expect(page.playlist.name).toBe("Test Playlist");
expect(page.tracks.map((track) => track.id)).toEqual([TRACK_A, TRACK_B]);
expect(page.totalCount).toBe(3);
expect(page.nextOffset).toBe(2);
expect(page.issues).toEqual([{ index: 1, reason: "unavailable" }]);
```

Also fake two Pathfinder responses and assert `fetchAllSpotifyPlaylistTracks()` requests offsets `0` then `2`, returns source order, and reports unavailable/non-track entries rather than silently dropping them.- [ ] **Step 2: Run the new test and confirm it fails**

Run: `bun test test/spotify-playlist.test.ts`

Expected: FAIL because `src/core/spotify-playlist.ts` does not exist.

- [ ] **Step 3: Implement the playlist client**

Use persisted query hash `86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0`, operation `fetchPlaylist`, and variables:

```ts
{
  uri: `spotify:playlist:${id}`,
  offset,
  limit,
  enableWatchFeedEntrypoint: false,
  includeEpisodeContentRatingsV2: true,
}
```

Normalize `data.playlistV2.content.items[].itemV2.data`, including title, artists, cover, duration and `playability.playable`; return explicit `issues` for malformed/unavailable entries. Clamp page size to 1–100 and reject non-22-character playlist IDs before making a network call.

- [ ] **Step 4: Run playlist-client tests**

Run: `bun test test/spotify-playlist.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/spotify-playlist.ts test/spotify-playlist.test.ts
git commit -m "feat: resolve Spotify playlists through Pathfinder"
```
### Task 2: Priority-aware pending queue

**Files:**
- Create: `webapp/src/server/priority-queue.ts`
- Create: `webapp/src/server/__tests__/priority-queue.test.ts`
- Modify: `webapp/src/server/jobs.ts`
- Modify: `webapp/src/components/soggfy/models.ts`

**Interfaces:**
- Produces: `QueueEntry`, `PriorityJobQueue.enqueue(entry)`, `.promote(jobId)`, `.shift()`, `.insertInterrupted(entry)`, `.remove(jobId)`, `.ids()`.
- Produces on `DownloadJob`: internal `priorityInterrupted?: boolean` flag used to abort an active attempt without turning the job into a user-visible terminal failure.

- [ ] **Step 1: Write failing ordering tests**

```ts
const queue = new PriorityJobQueue();
queue.enqueue(entry("A"));
queue.enqueue(entry("B"));
queue.enqueue(entry("C"));
queue.promote("C");
expect(queue.ids()).toEqual(["C", "A", "B"]);
queue.insertInterrupted(entry("X"));
expect(queue.ids()).toEqual(["C", "X", "A", "B"]);
```

Add a chained interruption case proving `C -> B -> A -> normal` ordering when each interrupted active entry is inserted directly behind the current priority head.- [ ] **Step 2: Run queue tests and confirm failure**

Run: `cd webapp && bun test src/server/__tests__/priority-queue.test.ts`

Expected: FAIL because `PriorityJobQueue` is not implemented.

- [ ] **Step 3: Implement the focused queue abstraction**

Keep queue entries compatible with the existing pool callbacks:

```ts
export interface QueueEntry {
  job: DownloadJob;
  resolve: (job: DownloadJob) => void;
  reject: (error: Error) => void;
}
```

`promote()` removes the matching entry and unshifts it. `insertInterrupted()` inserts at index 1 when a priority head exists, otherwise index 0. `enqueue()` deduplicates by job id. Keep interruption as an internal job flag; do not add a new visible download state.

- [ ] **Step 4: Run queue and job-registry tests**

Run: `cd webapp && bun test src/server/__tests__/priority-queue.test.ts src/server/__tests__/jobs.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/src/server/priority-queue.ts webapp/src/server/__tests__/priority-queue.test.ts webapp/src/server/jobs.ts webapp/src/components/soggfy/models.ts
git commit -m "feat: add priority-aware download queue"
```
### Task 3: Priority Play and explicit playlist APIs

**Files:**
- Modify: `webapp/src/index.ts`
- Modify: `webapp/src/server/spotify-url.ts`
- Modify: `webapp/src/server/__tests__/spotify-url.test.ts`
- Create: `webapp/src/server/__tests__/priority-play-source.test.ts`

**Interfaces:**
- Produces: `SpotifyPoolManager.playNow(trackParam): Promise<{ job: DownloadJob; interruptedJobId?: string }>`.
- Produces HTTP: `POST /api/play`, `GET /api/playlist`, `GET /api/track`, `POST /api/playlist/queue-all`.
- `GET /api/track?id=<track>` resolves one normalized track result without creating a job, using existing embed metadata/duration helpers.
- Consumes: playlist client from Task 1 and `PriorityJobQueue` from Task 2.

- [ ] **Step 1: Add failing URL and source-contract tests**

```ts
expect(parsePlaylistId(`spotify:playlist:${PLAYLIST_ID}`)).toBe(PLAYLIST_ID);
expect(parsePlaylistId(`https://open.spotify.com/playlist/${PLAYLIST_ID}?si=x`)).toBe(PLAYLIST_ID);
```

Add a source-level integration test that imports/reads `webapp/src/index.ts` and asserts the API routes and the special priority-interruption branch exist without requiring the server module to execute in the test process. This preserves the existing side-effectful server entrypoint while covering route wiring.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `bun test webapp/src/server/__tests__/spotify-url.test.ts webapp/src/server/__tests__/priority-play-source.test.ts`

Expected: FAIL on missing priority-play/API behavior.- [ ] **Step 3: Integrate priority interruption into `SpotifyPoolManager`**

Replace the raw pending array with `PriorityJobQueue`. In `assertJobActive()`, throw a dedicated `JobPriorityInterruptedError` when `job.priorityInterrupted` is set. `playNow()` must:

```ts
if (completedOutputExists) return { job: completedJob };
if (alreadyActive) return { job: activeJob };
const requested = await ensureQueuedJob(trackId);
queue.promote(requested.id);
if (activeDifferentJob) {
  activeDifferentJob.priorityInterrupted = true;
  await activeInstance.sendIPC(`cancel_track ${activeDifferentJob.trackId}`, 1, 1000);
  await activeInstance.sendIPC("pause", 1, 1000);
}
dispatch();
return { job: requested, interruptedJobId: activeDifferentJob?.id };
```

In the dispatch rejection path, detect `JobPriorityInterruptedError`, decrement the assignment attempt back to its prior value, clear capture paths/bytes/error/instance id and the interruption flag, transition the same job back to `queued`, and insert its queue entry immediately behind the priority head. Do not recycle the daemon instance for this expected scheduler event.

- [ ] **Step 4: Add explicit playlist routes without side effects**

`GET /api/playlist?id=...&offset=0&limit=100` resolves the playlist only and caches returned track metadata in `GLOBAL_METADATA`; it never calls `pool.addJob()`.

`POST /api/playlist/queue-all` calls `fetchAllSpotifyPlaylistTracks()`, queues playable tracks in source order, and returns:

```ts
{ success: true, total, newlyQueued, existing, skipped, trackIds }
```

`GET /api/track?id=...` validates one track id, resolves metadata and duration without creating a job, and returns a normalized `{ id, uri, type: "track", name, subtitle, imageUrl, durationMs }` result.

`POST /api/play` accepts one track URL/URI/id, calls `pool.playNow()`, and returns `{ success: true, job, interruptedJobId }`.

- [ ] **Step 5: Run server tests and typecheck**

Run: `bun test webapp/src/server/__tests__ test/spotify-playlist.test.ts && bun run typecheck:webapp`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/index.ts webapp/src/server/spotify-url.ts webapp/src/server/__tests__/spotify-url.test.ts webapp/src/server/__tests__/priority-play-source.test.ts
git commit -m "feat: add priority playback and playlist queue APIs"
```
### Task 4: Growing Ogg HTTP stream

**Files:**
- Create: `webapp/src/server/growing-file.ts`
- Create: `webapp/src/server/__tests__/growing-file.test.ts`
- Modify: `webapp/src/index.ts`

**Interfaces:**
- Produces: `streamGrowingFile(options): Response`, with `getPath()`, `getState()`, `signal`, `startupTimeoutMs`, and `pollMs` callbacks/options.
- Consumes: exact `jobId` plus `trackId` from `/api/stream` so a live stream never attaches to a stale capture attempt.

- [ ] **Step 1: Write failing delayed-file and append tests**

```ts
const response = streamGrowingFile({
  getPath: () => path,
  getState: () => state,
  startupTimeoutMs: 500,
  pollMs: 20,
});
writeFileSync(path, OGG_HEADER);
appendFileSync(path, OGG_PAGE);
expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.concat([OGG_HEADER, OGG_PAGE]));
```

Add cases for: file appears after the request starts, terminal state closes after final bytes, file shrink/replacement does not leak stale bytes, and AbortSignal cancellation ends the producer promptly.

- [ ] **Step 2: Run the test and confirm failure**

Run: `cd webapp && bun test src/server/__tests__/growing-file.test.ts`

Expected: FAIL because `streamGrowingFile` does not exist.- [ ] **Step 3: Implement growing-file streaming**

Use a `ReadableStream<Uint8Array>` that waits up to 20 seconds for a non-empty authoritative job capture path. Once present, read only newly appended byte ranges at a bounded 100 ms default poll interval. Track file size and treat shrink/replacement as a new attempt boundary rather than continuing from an old offset. Return headers:

```ts
{
  ...CORS_HEADERS,
  "Content-Type": "audio/ogg",
  "Cache-Control": "no-store",
  "Accept-Ranges": "none",
}
```

The producer closes when state becomes `completed`, `failed`, or `cancelled` after draining final bytes. Client abort only stops the HTTP producer.

- [ ] **Step 4: Wire `/api/stream`**

Completed output continues through `serveFileWithRange()`. For active playback require or infer the exact reusable job; when a `job` query parameter is supplied, reject a mismatch. Do not let `/api/stream` implicitly create a new job anymore: `/api/play` or `/api/download` owns job creation.

- [ ] **Step 5: Run streaming and existing media tests**

Run: `cd webapp && bun test src/server/__tests__/growing-file.test.ts src/server/__tests__/media.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/server/growing-file.ts webapp/src/server/__tests__/growing-file.test.ts webapp/src/index.ts
git commit -m "feat: stream growing Ogg captures"
```
### Task 5: Playlist detail and explicit Play/Queue UI

**Files:**
- Create: `webapp/src/components/soggfy/PlaylistPanel.tsx`
- Modify: `webapp/src/components/soggfy/SearchPanel.tsx`
- Modify: `webapp/src/components/soggfy/models.ts`
- Modify: `webapp/src/components/soggfy/workspace-model.ts`
- Modify: `webapp/src/components/soggfy/__tests__/workspace-model.test.ts`
- Modify: `webapp/src/App.tsx`

**Interfaces:**
- Produces frontend models: `PlaylistTrack`, `PlaylistDetail`, `PlaylistPage`.
- `SearchPanel` produces `onPlayTrack(trackId)` and `onOpenPlaylist(playlistId)` events in addition to `onQueue`.
- `PlaylistPanel` consumes playlist pages and exposes `onPlay`, `onQueue`, `onQueueAll`, `onLoadMore`, plus current job states keyed by track id.

- [ ] **Step 1: Write failing frontend model tests**

```ts
expect(actionForSearchResult(track)).toBe("track");
expect(actionForSearchResult(playlist)).toBe("playlist");
expect(mergePlaylistPages(first, second).tracks.map((t) => t.id)).toEqual(["a", "b", "c"]);
expect(jobStateByTrack(jobs).get("a")?.state).toBe("capturing");
```

The merge helper must preserve order and deduplicate overlapping page boundaries by track id + source index.

- [ ] **Step 2: Run the model test and confirm failure**

Run: `cd webapp && bun test src/components/soggfy/__tests__/workspace-model.test.ts`

Expected: FAIL on missing helpers/models.

- [ ] **Step 3: Implement explicit search actions and playlist detail state**

Track search rows render separate **Play** and **Queue** buttons. Playlist rows render **Open** and never queue directly. Artist behavior remains external-open.

In `App.tsx`, submitting recognized Spotify input follows entity resolution without queue mutation:

```ts
if (playlistId) return loadPlaylist(playlistId, 0, true);
if (trackId) {
  const response = await fetch(`/api/track?id=${encodeURIComponent(trackId)}`);
  return setSearchResults([await response.json()]);
}
```

For a bare 22-character id, call `/api/playlist?id=${id}&limit=100` first; on an explicit not-playlist response fall back to a single track result. Do not fall back on authentication/upstream errors. Album URLs/URIs keep the existing `/api/download` collection behavior.

`PlaylistPanel` renders metadata, total count, ordered track rows, **Queue all**, and a **Load more** control whenever `nextOffset !== null`. Row state comes from the current jobs snapshot; unavailable tracks show a disabled state rather than silently disappearing.

- [ ] **Step 4: Wire Play, Queue, Queue all, and additional pages**

`playTrack()` posts `{ trackId }` to `/api/play`, stores the returned exact `job.id` as `playerJobId`, and lets polling update the job object. `queueTrack()` posts the individual track to `/api/download`. `queueAll()` posts `{ playlistId }` to `/api/playlist/queue-all` and reports newly queued/existing/skipped counts. `loadMore()` fetches the next playlist page and merges it deterministically.

- [ ] **Step 5: Run frontend model test and typecheck**

Run: `cd webapp && bun test src/components/soggfy/__tests__/workspace-model.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/components/soggfy/PlaylistPanel.tsx webapp/src/components/soggfy/SearchPanel.tsx webapp/src/components/soggfy/models.ts webapp/src/components/soggfy/workspace-model.ts webapp/src/components/soggfy/__tests__/workspace-model.test.ts webapp/src/App.tsx
git commit -m "feat: add explicit playlist and track actions"
```
### Task 6: Active-download PlayerBar

**Files:**
- Modify: `webapp/src/components/soggfy/PlayerBar.tsx`
- Modify: `webapp/src/App.tsx`
- Create: `webapp/src/components/soggfy/__tests__/player-model.test.ts`
- Create: `webapp/src/components/soggfy/player-model.ts`

**Interfaces:**
- Produces: `playerStatus(job, playing, buffering)` and `seekLimit(job, duration)` pure helpers.
- PlayerBar consumes an active or completed `DownloadJob` and streams `/api/stream?track=<trackId>&job=<jobId>`.

- [ ] **Step 1: Write failing player-state tests**

```ts
expect(playerStatus(capturingJob, false, true)).toBe("Buffering");
expect(playerStatus(capturingJob, true, false)).toBe("Playing · downloading");
expect(playerStatus(capturingJob, false, false)).toBe("Paused · downloading");
expect(playerStatus(completedJob, false, false)).toBe("Downloaded");
```

Add a seek test that never advertises beyond the browser-reported buffered/downloaded duration for incomplete jobs and allows the full media duration for completed jobs.

- [ ] **Step 2: Run the player-model test and confirm failure**

Run: `cd webapp && bun test src/components/soggfy/__tests__/player-model.test.ts`

Expected: FAIL because the player helpers do not exist.- [ ] **Step 3: Let PlayerBar attach before completion**

Resolve `playerJob` by exact `playerJobId` from the current snapshot instead of filtering to `state === "completed"`. Set the audio source to the exact job stream URL and show a bounded startup/buffering state while the HTTP request waits for capture bytes.

Use media events `waiting`, `canplay`, `playing`, `pause`, `error`, and `progress` to maintain player state. A playback error surfaces in the bar but does not call any job action. Closing the player only clears `playerJobId`.

For incomplete jobs, constrain the range input max to the currently buffered end when available and disable seeking when no buffered range exists. When polling observes `completed`, reattach once to the completed range-capable endpoint while preserving current time as closely as the browser permits.

- [ ] **Step 4: Run player and workspace tests plus typecheck**

Run: `cd webapp && bun test src/components/soggfy/__tests__ && bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/src/components/soggfy/PlayerBar.tsx webapp/src/components/soggfy/player-model.ts webapp/src/components/soggfy/__tests__/player-model.test.ts webapp/src/App.tsx
git commit -m "feat: play active Ogg downloads in the browser"
```

### Task 7: End-to-end regression and rendered QA

**Files:**
- Modify only files required by defects found during verification.
- Update: `docs/superpowers/plans/2026-09-09-live-playback-playlist-queue.md` checkboxes as tasks complete.

**Interfaces:**
- Verifies all interfaces introduced by Tasks 1–6 against the running daemon.
- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
bun run typecheck
bun run typecheck:webapp
bun test
(cd webapp && bun run build)
```

Expected: all commands exit 0.

- [ ] **Step 2: Restart and probe the daemon API**

Run `soggfy daemon restart`, wait for `soggfy daemon status` to report Spotify IPC and Web UI/API responsive, then verify:

```bash
curl -fsS 'http://127.0.0.1:8085/api/playlist?id=5Rrf7mqN8uus2AaQQQNdc1&offset=0&limit=3'
curl -fsS -X POST -H 'content-type: application/json' -d '{"trackId":"6HSXNV0b4M4cLJ7ljgVVeh"}' http://127.0.0.1:8085/api/play
```

Before Queue all, compare `/api/jobs` before/after playlist inspection and confirm inspection created zero jobs.

- [ ] **Step 3: Verify live audio begins before completion**

Use a known playable track. Start `/api/play`, immediately attach to `/api/stream?track=<id>&job=<jobId>`, and record the first-byte timestamp plus job state from `/api/jobs`. Success requires audio bytes while the job is still `playing` or `capturing`, not only after `completed`.

Then start a second Play while the first job is capturing. Confirm the first job returns to `queued` with the same id and no net attempt penalty, the second becomes active, and after it finishes the first restarts from byte zero.

- [ ] **Step 4: Render desktop and mobile UI with existing Puppeteer Core**

Use `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` through `webapp/node_modules/puppeteer-core`. At 1440×1000 and 390×844, verify no console errors, no horizontal overflow, playlist rows expose Play/Queue, Queue all is visible, and PlayerBar shows live download status. Save screenshots under `/tmp/` for visual inspection.

- [ ] **Step 5: Fix only observed regressions and rerun the relevant failing test first**

Every correction gets a reproducing test where practical, followed by the focused test and then the complete verification commands from Step 1.

- [ ] **Step 6: Commit verification fixes if any**

```bash
git status --short
git diff --check
# Only when status contains verification-fix changes and no unrelated edits:
git add -A
git diff --cached --check
git commit -m "fix: harden live playback and playlist queueing"
```

If no fixes are required, make no empty commit.
