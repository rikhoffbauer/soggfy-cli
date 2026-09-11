import { afterEach, expect, test } from "bun:test";
import { invalidateSpotifyWebTokens } from "../../../../src/core/spotify-web-auth";
import { createApiRoutes } from "../routes";

const albumId = "4eLPsYPBmXABThSJ821sqY";
const trackId = "6HSXNV0b4M4cLJ7ljgVVeh";
const originalFetch = globalThis.fetch;
const savedAccess = process.env.SPOTIFY_ACCESS_TOKEN;
const savedClient = process.env.SPOTIFY_CLIENT_TOKEN;

afterEach(() => { globalThis.fetch = originalFetch; invalidateSpotifyWebTokens(); if (savedAccess === undefined) delete process.env.SPOTIFY_ACCESS_TOKEN; else process.env.SPOTIFY_ACCESS_TOKEN = savedAccess; if (savedClient === undefined) delete process.env.SPOTIFY_CLIENT_TOKEN; else process.env.SPOTIFY_CLIENT_TOKEN = savedClient; });

test("album route returns paginated album metadata and tracks", async () => {
  process.env.SPOTIFY_ACCESS_TOKEN = "access"; process.env.SPOTIFY_CLIENT_TOKEN = "client"; invalidateSpotifyWebTokens();
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { album: { uri: `spotify:album:${albumId}`, name: "Album", artists: { items: [{ profile: { name: "Artist" } }] }, coverArt: { sources: [{ url: "cover.jpg" }] }, tracks: { totalCount: 1, pagingInfo: { offset: 0, limit: 50 }, items: [{ track: { uri: `spotify:track:${trackId}`, name: "Song", artists: { items: [{ profile: { name: "Artist" } }] }, playability: { playable: true } } }] } } } }))) as unknown as typeof fetch;
  const route = createApiRoutes()["/api/album"]?.GET;
  expect(route).toBeDefined();
  if (!route) return;
  const response = await route(new Request(`http://localhost/api/album?id=${albumId}&limit=50`));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ album: { id: albumId, name: "Album" }, tracks: [{ id: trackId, name: "Song" }], totalCount: 1, nextOffset: null });
});

test("album route rejects invalid ids", async () => {
  const route = createApiRoutes()["/api/album"]?.GET;
  expect(route).toBeDefined();
  if (!route) return;
  expect((await route(new Request("http://localhost/api/album?id=bad"))).status).toBe(400);
});


test("album route preserves an upstream HTTP 404", async () => {
  process.env.SPOTIFY_ACCESS_TOKEN = "access"; process.env.SPOTIFY_CLIENT_TOKEN = "client"; invalidateSpotifyWebTokens();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/oembed?")) return new Response("{}", { status: 404 });
    return new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;
  const route = createApiRoutes()["/api/album"]?.GET;
  expect(route).toBeDefined();
  if (!route) return;
  const response = await route(new Request(`http://localhost/api/album?id=${albumId}`));
  expect(response.status).toBe(404);
});
