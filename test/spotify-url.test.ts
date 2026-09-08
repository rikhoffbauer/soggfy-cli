import { expect, test } from "bun:test";
import { parseAlbumId, parsePlaylistId, parseTrackId } from "../src/core/spotify-url";

const id = "4PTG3Z6ehGkBFwjybzWkR8";

test("Spotify entity parsers accept URLs and URIs", () => {
  expect(parseTrackId(`spotify:track:${id}`)).toBe(id);
  expect(parsePlaylistId(`https://open.spotify.com/playlist/${id}?si=x`)).toBe(id);
  expect(parsePlaylistId(`spotify:playlist:${id}`)).toBe(id);
  expect(parseAlbumId(`https://open.spotify.com/album/${id}`)).toBe(id);
  expect(parseAlbumId(`spotify:album:${id}`)).toBe(id);
});
