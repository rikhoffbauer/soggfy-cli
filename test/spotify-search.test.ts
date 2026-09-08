import { expect, test } from "bun:test";
import { normalizeSearchResponse, normalizeSearchTypes, clampSearchLimit } from "../src/core/spotify-search";

const response = {
  data: {
    searchV2: {
      tracks: { items: [{ item: { data: {
        id: "track1", uri: "spotify:track:track1", name: "Song One",
        artists: { items: [{ profile: { name: "Artist One" } }] },
        albumOfTrack: { coverArt: { sources: [{ url: "track.jpg" }] } },
      } } }] },
      artists: { items: [{ data: {
        id: "artist1", uri: "spotify:artist:artist1",
        profile: { name: "Artist One" },
        visuals: { avatarImage: { sources: [{ url: "artist.jpg" }] } },
      } }] },
      playlists: { items: [{ data: {
        id: "playlist1", uri: "spotify:playlist:playlist1", name: "Playlist One",
        ownerV2: { data: { name: "Owner One" } },
        images: { items: [{ sources: [{ url: "playlist.jpg" }] }] },
      } }] },
    },
  },
};

test("normalizes track, artist, and playlist results", () => {
  expect(normalizeSearchResponse(response)).toEqual([
    { id: "track1", uri: "spotify:track:track1", type: "track", name: "Song One", subtitle: "Artist One", imageUrl: "track.jpg" },
    { id: "artist1", uri: "spotify:artist:artist1", type: "artist", name: "Artist One", subtitle: "Artist", imageUrl: "artist.jpg" },
    { id: "playlist1", uri: "spotify:playlist:playlist1", type: "playlist", name: "Playlist One", subtitle: "Owner One", imageUrl: "playlist.jpg" },
  ]);
});

test("normalization ignores malformed entries without discarding valid results", () => {
  const malformed = structuredClone(response) as any;
  malformed.data.searchV2.tracks.items.unshift({ item: { data: null } });
  malformed.data.searchV2.artists.items.unshift({ data: { uri: "spotify:artist:no-name" } });
  expect(normalizeSearchResponse(malformed).map((item) => item.id)).toEqual(["track1", "artist1", "playlist1"]);
});

test("search type and limit helpers are strict and deterministic", () => {
  expect(normalizeSearchTypes("all")).toEqual(["track", "artist", "playlist"]);
  expect(normalizeSearchTypes("artist")).toEqual(["artist"]);
  expect(() => normalizeSearchTypes("album")).toThrow("Unsupported search type: album");
  expect(clampSearchLimit(0)).toBe(1);
  expect(clampSearchLimit(500)).toBe(50);
  expect(clampSearchLimit(12)).toBe(12);
});

test("searchSpotify filters result types using a supplied transport", async () => {
  const oldAccess = process.env.SPOTIFY_ACCESS_TOKEN;
  const oldClient = process.env.SPOTIFY_CLIENT_TOKEN;
  process.env.SPOTIFY_ACCESS_TOKEN = "access";
  process.env.SPOTIFY_CLIENT_TOKEN = "client";
  try {
    const { searchSpotify } = await import("../src/core/spotify-search");
    const results = await searchSpotify("one", {
      types: ["playlist"],
      limit: 5,
      fetchImpl: (async () => new Response(JSON.stringify(response), { status: 200 })) as typeof fetch,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe("playlist");
  } finally {
    if (oldAccess === undefined) delete process.env.SPOTIFY_ACCESS_TOKEN; else process.env.SPOTIFY_ACCESS_TOKEN = oldAccess;
    if (oldClient === undefined) delete process.env.SPOTIFY_CLIENT_TOKEN; else process.env.SPOTIFY_CLIENT_TOKEN = oldClient;
  }
});
