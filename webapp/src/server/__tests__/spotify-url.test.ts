import { expect, test } from "bun:test";
import { extractTrackIds, parseTrackId } from "../spotify-url";

const id = "4PTG3Z6ehGkBFwjybzWkR8";

test("parseTrackId accepts URLs, URIs, and bare IDs", () => {
  expect(parseTrackId(id)).toBe(id);
  expect(parseTrackId(`spotify:track:${id}`)).toBe(id);
  expect(parseTrackId(`https://open.spotify.com/track/${id}?si=x`)).toBe(id);
  expect(parseTrackId("not a track")).toBeNull();
});

test("extractTrackIds deduplicates IDs across Spotify markup shapes", () => {
  expect(extractTrackIds(`spotify:track:${id} https://open.spotify.com/track/${id} \"uri\":\"spotify:track:${id}\"`)).toEqual([id]);
});


test("collection parsers accept Spotify URLs and URIs", async () => {
  const { parsePlaylistId, parseAlbumId } = await import("../spotify-url");
  expect(parsePlaylistId(`https://open.spotify.com/playlist/${id}?si=x`)).toBe(id);
  expect(parsePlaylistId(`spotify:playlist:${id}`)).toBe(id);
  expect(parsePlaylistId(id)).toBe(id);
  expect(parseAlbumId(`https://open.spotify.com/album/${id}`)).toBe(id);
  expect(parseAlbumId(`spotify:album:${id}`)).toBe(id);
});
