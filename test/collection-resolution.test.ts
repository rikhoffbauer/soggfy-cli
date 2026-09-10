import { expect, test } from "bun:test";
import { resolveInput } from "../src/core/metadata";

const playlistId = "37i9dQZF1DXcBWIGoYBM5M";
const albumId = "4eLPsYPBmXABThSJ821sqY";
const trackA = "6HSXNV0b4M4cLJ7ljgVVeh";
const trackB = "6dGnYIeXmHdcikdzNNDMm2";

test("resolveInput uses complete paginated collection resolvers", async () => {
  expect(await resolveInput(`spotify:playlist:${playlistId}`, {
    fetchPlaylistTrackIds: async (id) => id === playlistId ? [trackA, trackB] : [],
    fetchAlbumTrackIds: async () => [],
  })).toEqual([trackA, trackB]);

  expect(await resolveInput(`spotify:album:${albumId}`, {
    fetchPlaylistTrackIds: async () => [],
    fetchAlbumTrackIds: async (id) => id === albumId ? [trackB, trackA] : [],
  })).toEqual([trackB, trackA]);
});