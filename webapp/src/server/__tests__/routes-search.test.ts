import { afterEach, expect, test } from "bun:test";
import { invalidateSpotifySearchTokens } from "../../../../src/core/spotify-search";
import { createApiRoutes } from "../routes";

const originalFetch = globalThis.fetch;
const savedAccess = process.env.SPOTIFY_ACCESS_TOKEN;
const savedClient = process.env.SPOTIFY_CLIENT_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  invalidateSpotifySearchTokens();
  if (savedAccess === undefined) delete process.env.SPOTIFY_ACCESS_TOKEN;
  else process.env.SPOTIFY_ACCESS_TOKEN = savedAccess;
  if (savedClient === undefined) delete process.env.SPOTIFY_CLIENT_TOKEN;
  else process.env.SPOTIFY_CLIENT_TOKEN = savedClient;
});

test("typed search defaults to 40 results and returns album pagination metadata", async () => {
  process.env.SPOTIFY_ACCESS_TOKEN = "access";
  process.env.SPOTIFY_CLIENT_TOKEN = "client";
  invalidateSpotifySearchTokens();
  let variables: any;
  globalThis.fetch = (async (_input, init) => {
    variables = JSON.parse(String(init?.body)).variables;
    return new Response(JSON.stringify({ data: { searchV2: { albums: { items: [{ data: {
      id: "album1", uri: "spotify:album:album1", name: "Album One",
      artists: { items: [{ profile: { name: "Artist One" } }] },
      coverArt: { sources: [{ url: "album.jpg" }] },
    } }] } } } }));
  }) as typeof fetch;

  const route = createApiRoutes()["/api/search"].GET;
  const response = await route(new Request("http://localhost/api/search?q=eminem&type=album&offset=80"));
  expect(response.status).toBe(200);
  expect(variables.limit).toBe(40);
  expect(variables.offset).toBe(80);
  expect(await response.json()).toEqual({
    type: "album", offset: 80, limit: 40, nextOffset: null,
    items: [{ id: "album1", uri: "spotify:album:album1", type: "album", name: "Album One", subtitle: "Artist One", imageUrl: "album.jpg" }],
  });
});

test("typed search rejects missing or unsupported result types", async () => {
  const route = createApiRoutes()["/api/search"].GET;
  expect((await route(new Request("http://localhost/api/search?q=eminem"))).status).toBe(400);
  expect((await route(new Request("http://localhost/api/search?q=eminem&type=all"))).status).toBe(400);
});
