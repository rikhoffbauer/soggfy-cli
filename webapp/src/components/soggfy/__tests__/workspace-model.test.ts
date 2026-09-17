import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DIAGNOSTICS_OPEN,
  filterSearchResults,
  partitionJobs,
  type FrontendDownloadJob,
  type FrontendSearchResult,
} from "../workspace-model";

const results: FrontendSearchResult[] = [
  { id: "t1", uri: "spotify:track:t1", type: "track", name: "Track", subtitle: "Artist" },
  { id: "a1", uri: "spotify:artist:a1", type: "artist", name: "Artist", subtitle: "Artist" },
  { id: "p1", uri: "spotify:playlist:p1", type: "playlist", name: "Playlist", subtitle: "Owner" },
];

describe("search result filtering", () => {
  test("all preserves catalog ordering", () => {
    expect(filterSearchResults(results, "all")).toEqual(results);
  });

  test("filters to a specific result type", () => {
    expect(filterSearchResults(results, "artist").map((item) => item.id)).toEqual(["a1"]);
  });
});

describe("job workspace partitioning", () => {
  const jobs = [
    { id: "1", trackId: "t1", state: "queued", createdAt: "2026-09-08T00:00:00Z" },
    { id: "2", trackId: "t2", state: "capturing", createdAt: "2026-09-08T00:01:00Z" },
    { id: "3", trackId: "t3", state: "completed", createdAt: "2026-09-08T00:02:00Z" },
    { id: "4", trackId: "t4", state: "failed", createdAt: "2026-09-08T00:03:00Z" },
  ] as FrontendDownloadJob[];

  test("keeps active work in queue and terminal work in library", () => {
    const partitioned = partitionJobs(jobs);
    expect(partitioned.queue.map((job) => job.id)).toEqual(["1", "2"]);
    expect(partitioned.library.map((job) => job.id)).toEqual(["4", "3"]);
  });
});

test("diagnostics are collapsed by default", () => {
  expect(DEFAULT_DIAGNOSTICS_OPEN).toBe(false);
});


test("search results map to queueable Spotify inputs", async () => {
  const { downloadInputForSearchResult } = await import("../workspace-model");
  expect(downloadInputForSearchResult(results[0]!)).toBe("spotify:track:t1");
  expect(downloadInputForSearchResult(results[2]!)).toBe("https://open.spotify.com/playlist/p1");
  expect(downloadInputForSearchResult(results[1]!)).toBeNull();
});

test("search result actions distinguish tracks, playlists, and artists", async () => {
  const { actionForSearchResult } = await import("../workspace-model");
  expect(actionForSearchResult(results[0]!)).toBe("track");
  expect(actionForSearchResult(results[2]!)).toBe("playlist");
  expect(actionForSearchResult(results[1]!)).toBe("artist");
});

test("playlist pages merge in source order without overlapping duplicates", async () => {
  const { mergePlaylistPages } = await import("../workspace-model");
  const first: any = {
    playlist: { id: "p1", uri: "spotify:playlist:p1", name: "P", owner: "O" },
    tracks: [
      { id: "a", uri: "spotify:track:a", name: "A", artists: [], playable: true, sourceIndex: 0 },
      { id: "b", uri: "spotify:track:b", name: "B", artists: [], playable: true, sourceIndex: 1 },
    ],
    issues: [], offset: 0, limit: 2, totalCount: 3, nextOffset: 2,
  };
  const second: any = {
    ...first,
    tracks: [
      { ...first.tracks[1], sourceIndex: 1 },
      { id: "c", uri: "spotify:track:c", name: "C", artists: [], playable: true, sourceIndex: 2 },
    ],
    offset: 1, nextOffset: null,
  };
  expect(mergePlaylistPages(first, second).tracks.map((track: any) => track.id)).toEqual(["a", "b", "c"]);
});

test("job state lookup returns the latest job for each track", async () => {
  const { jobStateByTrack } = await import("../workspace-model");
  const jobs = [
    { id: "old", trackId: "a", state: "failed", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:01Z" },
    { id: "new", trackId: "a", state: "capturing", createdAt: "2026-09-08T00:01:00Z", updatedAt: "2026-09-08T00:01:01Z" },
  ] as FrontendDownloadJob[];
  expect(jobStateByTrack(jobs).get("a")?.id).toBe("new");
  expect(jobStateByTrack(jobs).get("a")?.state).toBe("capturing");
});

test("lower health revision forces a full snapshot after daemon restart", async () => {
  const { revisionResetAfterHealth } = await import("../workspace-model");
  expect(revisionResetAfterHealth(42, 3)).toEqual({ restarted: true, since: 2 });
  expect(revisionResetAfterHealth(3, 3)).toEqual({ restarted: false, since: 3 });
  expect(revisionResetAfterHealth(3, undefined)).toEqual({ restarted: false, since: 3 });
});


describe("multi-page workspace navigation", () => {
  test("maps only known hashes to pages and defaults to search", async () => {
    const { pageFromHash, hashForPage } = await import("../workspace-model");
    expect(pageFromHash("#queue")).toBe("queue");
    expect(pageFromHash("#downloads")).toBe("downloads");
    expect(pageFromHash("#diagnostics")).toBe("diagnostics");
    expect(pageFromHash("#wat")).toBe("search");
    expect(hashForPage("search")).toBe("#search");
  });
});

describe("typed search session state", () => {
  test("new sessions default to Tracks and keep independent lazy tab caches", async () => {
    const { createSearchSession, searchTabNeedsLoad } = await import("../workspace-model");
    const session = createSearchSession("eminem");
    expect(session.query).toBe("eminem");
    expect(session.activeTab).toBe("track");
    expect(Object.keys(session.tabs)).toEqual(["track", "album", "playlist", "artist"]);
    expect(searchTabNeedsLoad(session, "track")).toBe(true);
    expect(searchTabNeedsLoad(session, "album")).toBe(true);
  });

  test("merges paginated tab results without duplicates and leaves other tabs untouched", async () => {
    const { createSearchSession, mergeSearchTabPage, searchTabNeedsLoad } = await import("../workspace-model");
    const session = createSearchSession("eminem");
    const first = mergeSearchTabPage(session, "track", {
      items: [
        { id: "a", uri: "spotify:track:a", type: "track", name: "A", subtitle: "Artist" },
        { id: "b", uri: "spotify:track:b", type: "track", name: "B", subtitle: "Artist" },
      ],
      nextOffset: 40,
    });
    const second = mergeSearchTabPage(first, "track", {
      items: [
        { id: "b", uri: "spotify:track:b", type: "track", name: "B", subtitle: "Artist" },
        { id: "c", uri: "spotify:track:c", type: "track", name: "C", subtitle: "Artist" },
      ],
      nextOffset: null,
    }, true);
    expect(second.tabs.track.items.map((item: any) => item.id)).toEqual(["a", "b", "c"]);
    expect(second.tabs.track.nextOffset).toBeNull();
    expect(searchTabNeedsLoad(second, "track")).toBe(false);
    expect(searchTabNeedsLoad(second, "album")).toBe(true);
  });

  test("starting a different query resets every tab cache", async () => {
    const { createSearchSession, mergeSearchTabPage, resetSearchSessionQuery } = await import("../workspace-model");
    const loaded = mergeSearchTabPage(createSearchSession("eminem"), "track", {
      items: [{ id: "a", uri: "spotify:track:a", type: "track", name: "A", subtitle: "Artist" }], nextOffset: null,
    });
    const reset = resetSearchSessionQuery(loaded, "dr dre");
    expect(reset.query).toBe("dr dre");
    expect(reset.activeTab).toBe("track");
    expect(reset.tabs.track.items).toEqual([]);
    expect(reset.tabs.album.loaded).toBe(false);
  });
});


test("album pages merge in source order without duplicate tracks", async () => {
  const { mergeAlbumPages } = await import("../workspace-model");
  const first: any = {
    album: { id: "a1", uri: "spotify:album:a1", name: "Album", artists: ["Artist"] },
    tracks: [
      { id: "t1", uri: "spotify:track:t1", name: "One", artists: ["Artist"], playable: true, sourceIndex: 0 },
      { id: "t2", uri: "spotify:track:t2", name: "Two", artists: ["Artist"], playable: true, sourceIndex: 1 },
    ],
    trackIds: ["t1", "t2"], offset: 0, limit: 2, totalCount: 3, nextOffset: 2,
  };
  const second: any = {
    ...first,
    tracks: [
      { ...first.tracks[1], sourceIndex: 1 },
      { id: "t3", uri: "spotify:track:t3", name: "Three", artists: ["Artist"], playable: true, sourceIndex: 2 },
    ],
    trackIds: ["t2", "t3"], offset: 1, nextOffset: null,
  };
  const merged = mergeAlbumPages(first, second);
  expect(merged.tracks.map((track: any) => track.id)).toEqual(["t1", "t2", "t3"]);
  expect(merged.trackIds).toEqual(["t1", "t2", "t3"]);
});


test("album page merge preserves repeated tracks at distinct source positions", async () => {
  const { mergeAlbumPages } = await import("../workspace-model");
  const first: any = {
    album: { id: "a1", uri: "spotify:album:a1", name: "Album", artists: ["Artist"] },
    tracks: [
      { id: "t1", uri: "spotify:track:t1", name: "One", artists: ["Artist"], playable: true, sourceIndex: 0 },
      { id: "t2", uri: "spotify:track:t2", name: "Repeat", artists: ["Artist"], playable: true, sourceIndex: 1 },
    ],
    trackIds: ["t1", "t2"], offset: 0, limit: 2, totalCount: 3, nextOffset: 2,
  };
  const second: any = { ...first, tracks: [
    { ...first.tracks[1], sourceIndex: 1 },
    { ...first.tracks[1], sourceIndex: 2 },
  ], trackIds: ["t2", "t2"], offset: 1, nextOffset: null };
  const merged = mergeAlbumPages(first, second);
  expect(merged.tracks.map((track: any) => [track.sourceIndex, track.id])).toEqual([[0, "t1"], [1, "t2"], [2, "t2"]]);
  expect(merged.trackIds).toEqual(["t1", "t2", "t2"]);
});

test("workspace hashes round-trip search tabs and details", async () => {
  const { workspaceLocationFromHash, hashForWorkspaceLocation } = await import("../workspace-model");
  const album = "4eLPsYPBmXABThSJ821sqY";
  const playlist = "37i9dQZF1DXcBWIGoYBM5M";
  expect(workspaceLocationFromHash(`#search?tab=album&album=${album}`)).toEqual({ page: "search", searchTab: "album", detail: { type: "album", id: album } });
  expect(workspaceLocationFromHash(`#search?tab=playlist&playlist=${playlist}`)).toEqual({ page: "search", searchTab: "playlist", detail: { type: "playlist", id: playlist } });
  expect(workspaceLocationFromHash(`#search?tab=track&album=${album}`)).toEqual({ page: "search", searchTab: "album", detail: { type: "album", id: album } });
  expect(workspaceLocationFromHash(`#search?tab=artist&playlist=${playlist}`)).toEqual({ page: "search", searchTab: "playlist", detail: { type: "playlist", id: playlist } });
  expect(hashForWorkspaceLocation({ page: "search", searchTab: "album", detail: { type: "album", id: album } })).toBe(`#search?tab=album&album=${album}`);
  expect(hashForWorkspaceLocation({ page: "downloads" })).toBe("#downloads");
  expect(workspaceLocationFromHash("#spotify?collection=liked")).toEqual({
    page: "spotify", spotifyCollection: { type: "liked" },
  });
  expect(workspaceLocationFromHash(`#spotify?playlist=${playlist}`)).toEqual({
    page: "spotify", spotifyCollection: { type: "playlist", id: playlist },
  });
  expect(hashForWorkspaceLocation({ page: "spotify", spotifyCollection: { type: "liked" } })).toBe("#spotify?collection=liked");
  expect(hashForWorkspaceLocation({ page: "spotify", spotifyCollection: { type: "playlist", id: playlist } })).toBe(`#spotify?playlist=${playlist}`);
});
