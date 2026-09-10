import { expect, test } from "bun:test";
import { normalizeSpotifyAlbumResponse } from "../src/core/spotify-album";

const albumId = "4eLPsYPBmXABThSJ821sqY";
const trackA = "6HSXNV0b4M4cLJ7ljgVVeh";
const trackB = "6dGnYIeXmHdcikdzNNDMm2";

test("normalizes album track pages and advances pagination", () => {
  const page = normalizeSpotifyAlbumResponse({ data: { album: {
    uri: `spotify:album:${albumId}`,
    tracks: {
      totalCount: 3,
      items: [
        { track: { uri: `spotify:track:${trackA}`, name: "A" } },
        { track: { uri: `spotify:track:${trackB}`, name: "B" } },
      ],
    },
  } } }, 0, 2);
  expect(page.trackIds).toEqual([trackA, trackB]);
  expect(page.totalCount).toBe(3);
  expect(page.nextOffset).toBe(2);
});