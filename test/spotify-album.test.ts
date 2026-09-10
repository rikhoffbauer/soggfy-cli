import { afterEach, expect, test } from "bun:test";
import { invalidateSpotifyWebTokens } from "../src/core/spotify-web-auth";
import { normalizeSpotifyAlbumResponse } from "../src/core/spotify-album";

const albumId = "4eLPsYPBmXABThSJ821sqY";
const trackA = "6HSXNV0b4M4cLJ7ljgVVeh";
const trackB = "6dGnYIeXmHdcikdzNNDMm2";

function fixture(offset = 0, limit = 2, totalCount = 3) {
  return { data: { albumUnion: {
    __typename: "Album", uri: `spotify:album:${albumId}`, name: "Test Album",
    artists: { items: [{ profile: { name: "Album Artist" } }] },
    coverArt: { sources: [{ url: "album.jpg" }] },
    tracks: { totalCount, pagingInfo: { offset, limit }, items: [
      { track: { uri: `spotify:track:${trackA}`, name: "First", artists: { items: [{ profile: { name: "Artist A" } }] }, trackDuration: { totalMilliseconds: 123000 }, playability: { playable: true } } },
      { track: { uri: `spotify:track:${trackB}`, name: "Second", artists: { items: [{ profile: { name: "Artist B" } }] }, trackDuration: { totalMilliseconds: 234000 }, playability: { playable: false } } },
    ] },
  } } };
}

afterEach(() => { invalidateSpotifyWebTokens(); delete process.env.SPOTIFY_ACCESS_TOKEN; delete process.env.SPOTIFY_CLIENT_TOKEN; });

test("normalizes album metadata and track rows while preserving track ids", () => {
  const page = normalizeSpotifyAlbumResponse(fixture(), 0, 2);
  expect(page.album).toEqual({ id: albumId, uri: `spotify:album:${albumId}`, name: "Test Album", artists: ["Album Artist"], imageUrl: "album.jpg" });
  expect(page.trackIds).toEqual([trackA, trackB]);
  expect(page.tracks).toEqual([
    { id: trackA, uri: `spotify:track:${trackA}`, name: "First", artists: ["Artist A"], durationMs: 123000, playable: true, sourceIndex: 0 },
    { id: trackB, uri: `spotify:track:${trackB}`, name: "Second", artists: ["Artist B"], durationMs: 234000, playable: false, sourceIndex: 1 },
  ]);
  expect(page.totalCount).toBe(3);
  expect(page.nextOffset).toBe(2);
});

test("fetchSpotifyAlbumPage forwards offset and limit", async () => {
  const { fetchSpotifyAlbumPage } = await import("../src/core/spotify-album");
  process.env.SPOTIFY_ACCESS_TOKEN = "access"; process.env.SPOTIFY_CLIENT_TOKEN = "client";
  let variables: any;
  const page = await fetchSpotifyAlbumPage(albumId, { offset: 20, limit: 25, fetchImpl: (async (_input, init) => { variables = JSON.parse(String(init?.body)).variables; return new Response(JSON.stringify(fixture(20, 25, 22))); }) as typeof fetch });
  expect(variables).toMatchObject({ uri: `spotify:album:${albumId}`, offset: 20, limit: 25 });
  expect(page.offset).toBe(20);
});
