import { expect, test } from "bun:test";
import { collectRendererLikedSongs, collectRendererPages, waitForRendererLibraryReady } from "../src/core/spotify-renderer-library";

test("renderer pagination continues after a short page when no total is advertised", async () => {
  const requests: number[] = [];
  const pages = new Map<number, { items: number[]; totalLength: number }>([
    [0, { items: [1, 2, 3], totalLength: 0 }],
    [3, { items: [4], totalLength: 0 }],
    [4, { items: [5, 6], totalLength: 0 }],
    [6, { items: [], totalLength: 0 }],
  ]);
  const result = await collectRendererPages(async (offset) => {
    requests.push(offset);
    return pages.get(offset) ?? { items: [], totalLength: 0 };
  }, 3);
  expect(result.items).toEqual([1, 2, 3, 4, 5, 6]);
  expect(result.totalCount).toBe(6);
  expect(requests).toEqual([0, 3, 4, 6]);
});

test("renderer pagination stops at an advertised total without an extra request", async () => {
  const requests: number[] = [];
  const result = await collectRendererPages(async (offset) => {
    requests.push(offset);
    return offset === 0
      ? { items: [1, 2], totalLength: 3 }
      : { items: [3], totalLength: 3 };
  }, 2);
  expect(result).toEqual({ items: [1, 2, 3], totalCount: 3 });
  expect(requests).toEqual([0, 2]);
});

import { waitForRendererLikedSongsReady } from "../src/core/spotify-renderer-library";

test("renderer library waits past a temporary local-only liked-song view", async () => {
  let calls = 0;
  const waits: number[] = [];
  await waitForRendererLikedSongsReady(async () => {
    calls += 1;
    return calls === 1
      ? { items: [{ uri: "spotify:local:::temporary:1", isLocal: true }], totalLength: 0 }
      : { items: [{ uri: "spotify:track:1111111111111111111111", isLocal: false }], totalLength: 0 };
  }, 3, 25, async (ms) => { waits.push(ms); });
  expect(calls).toBe(2);
  expect(waits).toEqual([25]);
});

test("renderer library eventually accepts a genuinely local-only account", async () => {
  let calls = 0;
  await waitForRendererLikedSongsReady(async () => {
    calls += 1;
    return { items: [{ uri: "spotify:local:::only:1", isLocal: true }], totalLength: 0 };
  }, 3, 0, async () => {});
  expect(calls).toBe(3);
});


test("renderer liked songs prefer the canonical liked-songs pseudo-playlist", async () => {
  let trackCalls = 0;
  const playlistOffsets: number[] = [];
  const result = await collectRendererLikedSongs(
    async () => {
      trackCalls += 1;
      return { items: [{ uri: "spotify:local:::stale:1", isLocal: true }], totalLength: 0 };
    },
    async (_uri, offset) => {
      playlistOffsets.push(offset);
      return offset === 0
        ? { items: [{ uri: "spotify:track:1111111111111111111111" }], totalLength: 2 }
        : { items: [{ uri: "spotify:local:::canonical:1", isLocal: true }], totalLength: 2 };
    },
    "spotify:playlist:37i9dQZF1F5likedSongs",
  );

  expect(trackCalls).toBe(0);
  expect(playlistOffsets).toEqual([0, 1]);
  expect(result.totalCount).toBe(2);
  expect(result.items).toHaveLength(2);
});

test("renderer liked songs fall back to LibraryAPI.getTracks when pseudo-playlist is unavailable", async () => {
  let playlistCalls = 0;
  const result = await collectRendererLikedSongs(
    async (offset) => offset === 0
      ? { items: [{ uri: "spotify:track:2222222222222222222222" }], totalLength: 1 }
      : { items: [], totalLength: 1 },
    async () => {
      playlistCalls += 1;
      throw new Error("playlist API unavailable");
    },
    "spotify:playlist:37i9dQZF1F5likedSongs",
    { readinessAttempts: 1, readinessPollMs: 0, sleepImpl: async () => {} },
  );

  expect(playlistCalls).toBe(1);
  expect(result.items).toHaveLength(1);
  expect(result.totalCount).toBe(1);
});


test("renderer library readiness waits for the React service registry instead of failing cold startup", async () => {
  let attempts = 0;
  const waits: number[] = [];
  const value = await waitForRendererLibraryReady(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Spotify renderer root is unavailable");
    if (attempts === 2) throw new Error("Spotify renderer React tree is unavailable");
    if (attempts === 3) throw new Error("Spotify renderer service registry is unavailable");
    return { id: "account", likedSongsUri: "spotify:playlist:liked" };
  }, 5, 25, async (ms) => { waits.push(ms); });

  expect(value).toEqual({ id: "account", likedSongsUri: "spotify:playlist:liked" });
  expect(attempts).toBe(4);
  expect(waits).toEqual([25, 25, 25]);
});

test("renderer library readiness does not retry unrelated evaluation failures", async () => {
  let attempts = 0;
  await expect(waitForRendererLibraryReady(async () => {
    attempts += 1;
    throw new Error("Playlist permission denied");
  }, 5, 0, async () => {})).rejects.toThrow("Playlist permission denied");
  expect(attempts).toBe(1);
});
