import { afterEach, expect, test } from "bun:test";
import { invalidateSpotifyWebTokens } from "../src/core/spotify-web-auth";

const PLAYLIST_ID = "5Rrf7mqN8uus2AaQQQNdc1";
const TRACK_A = "6HSXNV0b4M4cLJ7ljgVVeh";
const TRACK_B = "6dGnYIeXmHdcikdzNNDMm2";
const TRACK_C = "0V3wPSX9ygBnCm8psDIegu";

async function playlistModule(): Promise<any> {
  try {
    return await import("../src/core/spotify-playlist");
  } catch {
    return {};
  }
}

function track(uri: string, name: string, artist: string, playable = true) {
  return {
    itemV2: { data: {
      __typename: "Track",
      uri: `spotify:track:${uri}`,
      name,
      artists: { items: [{ profile: { name: artist } }] },
      albumOfTrack: { coverArt: { sources: [{ url: `${uri}.jpg` }] } },
      trackDuration: { totalMilliseconds: 123_000 },
      playability: { playable },
    } },
  };
}function fixture(items: unknown[], offset = 0, limit = items.length, totalCount = items.length) {
  return { data: { playlistV2: {
    __typename: "Playlist",
    uri: `spotify:playlist:${PLAYLIST_ID}`,
    name: "Test Playlist",
    description: "Fixture playlist",
    ownerV2: { data: { name: "Fixture Owner" } },
    images: { items: [{ sources: [{ url: "playlist.jpg" }] }] },
    content: {
      items,
      pagingInfo: { offset, limit },
      totalCount,
    },
  } } };
}

afterEach(() => {
  invalidateSpotifyWebTokens();
  delete process.env.SPOTIFY_ACCESS_TOKEN;
  delete process.env.SPOTIFY_CLIENT_TOKEN;
});

test("normalizes playlist metadata, ordered tracks, and unavailable entries", async () => {
  const mod = await playlistModule();
  expect(typeof mod.normalizeSpotifyPlaylistResponse).toBe("function");
  if (typeof mod.normalizeSpotifyPlaylistResponse !== "function") return;

  const page = mod.normalizeSpotifyPlaylistResponse(
    fixture([track(TRACK_A, "First", "Artist A"), { itemV2: { data: null } }, track(TRACK_B, "Second", "Artist B", false)], 0, 3, 4),
    0,
    3,
  );  expect(page.playlist).toMatchObject({
    id: PLAYLIST_ID,
    name: "Test Playlist",
    owner: "Fixture Owner",
    imageUrl: "playlist.jpg",
  });
  expect(page.tracks.map((item: any) => item.id)).toEqual([TRACK_A, TRACK_B]);
  expect(page.tracks[0]).toMatchObject({
    name: "First",
    artists: ["Artist A"],
    imageUrl: `${TRACK_A}.jpg`,
    durationMs: 123_000,
    playable: true,
    sourceIndex: 0,
  });
  expect(page.tracks[1]).toMatchObject({ playable: false, sourceIndex: 2 });
  expect(page.issues).toEqual([{ index: 1, reason: "unavailable" }]);
  expect(page.totalCount).toBe(4);
  expect(page.nextOffset).toBe(3);
});

test("fetches all playlist pages in source order", async () => {
  const mod = await playlistModule();
  expect(typeof mod.fetchAllSpotifyPlaylistTracks).toBe("function");
  if (typeof mod.fetchAllSpotifyPlaylistTracks !== "function") return;

  process.env.SPOTIFY_ACCESS_TOKEN = "access";
  process.env.SPOTIFY_CLIENT_TOKEN = "client";
  const offsets: number[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    offsets.push(body.variables.offset);    const offset = body.variables.offset;
    const payload = offset === 0
      ? fixture([track(TRACK_A, "A", "Artist A"), { itemV2: { data: null } }], 0, 2, 4)
      : fixture([track(TRACK_B, "B", "Artist B"), track(TRACK_C, "C", "Artist C")], 2, 2, 4);
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;

  const result = await mod.fetchAllSpotifyPlaylistTracks(PLAYLIST_ID, {
    limit: 2,
    fetchImpl,
  });

  expect(offsets).toEqual([0, 2]);
  expect(result.tracks.map((item: any) => item.id)).toEqual([TRACK_A, TRACK_B, TRACK_C]);
  expect(result.issues).toEqual([{ index: 1, reason: "unavailable" }]);
  expect(result.totalCount).toBe(4);
});

test("rejects invalid playlist ids before calling Pathfinder", async () => {
  const mod = await playlistModule();
  expect(typeof mod.fetchSpotifyPlaylistPage).toBe("function");
  if (typeof mod.fetchSpotifyPlaylistPage !== "function") return;
  let called = false;
  await expect(mod.fetchSpotifyPlaylistPage("invalid", {
    fetchImpl: (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch,
  })).rejects.toThrow("Invalid Spotify playlist ID");
  expect(called).toBe(false);
});
