import { afterEach, expect, test } from "bun:test";
import { createApiRoutes } from "../routes";

const originalFetch = globalThis.fetch;
const savedCookie = process.env.SPOTIFY_COOKIE;
const trackId = "1111111111111111111111";

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (savedCookie === undefined) delete process.env.SPOTIFY_COOKIE;
  else process.env.SPOTIFY_COOKIE = savedCookie;
});

test("library route returns the authenticated Soggfy account snapshot", async () => {
  process.env.SPOTIFY_COOKIE = "sp_dc=private-session";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "open.spotify.com" && url.pathname === "/api/token") {
      return Response.json({ accessToken: "access", accessTokenExpirationTimestampMs: Date.now() + 60_000 });
    }
    if (url.pathname === "/v1/me") return Response.json({ id: "account", display_name: "Account" });
    if (url.pathname === "/v1/me/tracks") return Response.json({
      items: [{ track: {
        id: trackId, type: "track", name: "Song", artists: [{ name: "Artist" }],
        album: { name: "Album", images: [] }, duration_ms: 1000,
      } }], total: 1, next: null,
    });
    if (url.pathname === "/v1/me/playlists") return Response.json({ items: [], total: 0, next: null });
    return new Response("missing", { status: 404 });
  }) as typeof fetch;

  const route = createApiRoutes()["/api/library"]?.GET;
  expect(route).toBeDefined();
  if (!route) return;
  const response = await route();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    account: { id: "account", displayName: "Account" },
    likedSongs: { tracks: [{ id: trackId, title: "Song" }] },
    playlists: [],
  });
});

test("library route returns 401 for an unauthenticated Soggfy session", async () => {
  process.env.SPOTIFY_COOKIE = "sp_dc=expired";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "open.spotify.com") {
      return Response.json({ accessToken: "expired-access", accessTokenExpirationTimestampMs: Date.now() + 60_000 });
    }
    return new Response("unauthorized", { status: 401 });
  }) as typeof fetch;
  const route = createApiRoutes()["/api/library"]?.GET;
  expect(route).toBeDefined();
  if (!route) return;
  const response = await route();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Soggfy does not have an authenticated Spotify session with library access" });
});
