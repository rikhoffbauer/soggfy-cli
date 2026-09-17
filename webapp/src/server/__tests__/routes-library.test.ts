import { expect, test } from "bun:test";
import { createApiRoutes } from "../routes";

const trackId = "1111111111111111111111";

test("library route returns the authenticated Soggfy account snapshot", async () => {
  const route = createApiRoutes({
    libraryProvider: async () => ({
      account: { id: "account", displayName: "Account" },
      likedSongs: {
        tracks: [{
          id: trackId, uri: `spotify:track:${trackId}`, title: "Song", artists: ["Artist"],
          album: "Album", durationMs: 1000, playable: true,
        }],
        issues: [], totalCount: 1,
      },
      playlists: [],
    }),
  })["/api/library"]?.GET;
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

test("library route returns 401 for an unauthenticated Soggfy renderer session", async () => {
  const route = createApiRoutes({
    libraryProvider: async () => {
      throw new Error("Soggfy renderer does not contain an authenticated Spotify session");
    },
  })["/api/library"]?.GET;
  expect(route).toBeDefined();
  if (!route) return;
  const response = await route();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: "Soggfy renderer does not contain an authenticated Spotify session",
  });
});
