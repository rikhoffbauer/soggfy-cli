import { expect, test } from "bun:test";
import { fetchSpotifyLibrarySnapshot } from "../src/core/spotify-library";

const ids = {
  likedA: "1111111111111111111111",
  likedB: "2222222222222222222222",
  playlist: "3333333333333333333333",
  playlistTrack: "4444444444444444444444",
  followedPlaylist: "5555555555555555555555",
};

function track(id: string, name: string) {
  return {
    id, uri: `spotify:track:${id}`, type: "track", name,
    artists: [{ name: "Artist" }],
    album: { name: "Album", images: [{ url: `${id}.jpg` }] },
    duration_ms: 123000, is_playable: true,
  };
}

test("fetchSpotifyLibrarySnapshot paginates liked songs and preserves playlist membership order", async () => {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(`${url.pathname}?${url.searchParams}`);
    if (url.pathname === "/v1/me") {
      return Response.json({ id: "account", display_name: "Account" });
    }
    if (url.pathname === "/v1/me/tracks") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return Response.json(offset === 0
        ? { items: [{ added_at: "2026-01-01", track: track(ids.likedA, "Liked A") }], total: 2, next: "page2" }
        : { items: [{ added_at: "2026-01-02", track: track(ids.likedB, "Liked B") }], total: 2, next: null });
    }
    if (url.pathname === "/v1/me/playlists") {
      return Response.json({ items: [{
        id: ids.playlist, name: "Roadtrip", description: "desc", snapshot_id: "snap-1",
        owner: { display_name: "Account" }, images: [{ url: "playlist.jpg" }],
        items: { total: 4 },
      }, {
        id: ids.followedPlaylist, name: "Followed", snapshot_id: "snap-followed",
        owner: { display_name: "Someone Else" }, items: { total: 7 },
      }], total: 2, next: null });
    }
    if (url.pathname === `/v1/playlists/${ids.playlist}/items`) {
      return Response.json({ items: [
        { item: track(ids.playlistTrack, "Playlist Track") },
        { item: track(ids.playlistTrack, "Playlist Track") },
        { item: { type: "episode", id: "episode" } },
        { item: null },
      ], total: 4, next: null });
    }
    if (url.pathname === `/v1/playlists/${ids.followedPlaylist}/items`) {
      return new Response("forbidden", { status: 403 });
    }
    return new Response("missing", { status: 404 });
  }) as typeof fetch;

  const snapshot = await fetchSpotifyLibrarySnapshot({
    tokenProvider: async () => ({ accessToken: "access", expiresAt: Date.now() + 60_000 }),
    fetchImpl,
  });

  expect(snapshot.account).toEqual({ id: "account", displayName: "Account" });
  expect(snapshot.likedSongs.tracks.map((item) => item.id)).toEqual([ids.likedA, ids.likedB]);
  expect(snapshot.playlists).toHaveLength(2);
  expect(snapshot.playlists[0]?.contentsAvailable).toBe(true);
  expect(snapshot.playlists[0]?.tracks.map((item) => item.id)).toEqual([ids.playlistTrack, ids.playlistTrack]);
  expect(snapshot.playlists[0]?.issues).toEqual([
    { index: 2, reason: "non-track" },
    { index: 3, reason: "unavailable" },
  ]);
  expect(snapshot.playlists[0]?.snapshotId).toBe("snap-1");
  expect(snapshot.playlists[0]?.tracks[0]).toMatchObject({
    title: "Playlist Track", artists: ["Artist"], album: "Album",
    imageUrl: `${ids.playlistTrack}.jpg`, durationMs: 123000,
  });
  expect(snapshot.playlists[1]).toMatchObject({
    id: ids.followedPlaylist, name: "Followed", contentsAvailable: false,
    tracks: [], issues: [], totalCount: 7,
  });
  expect(requests.filter((value) => value.startsWith("/v1/me/tracks?"))).toHaveLength(2);
});

test("fetchSpotifyLibrarySnapshot fails explicitly when the Soggfy session is not authenticated", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 })) as typeof fetch;
  await expect(fetchSpotifyLibrarySnapshot({
    tokenProvider: async () => ({ accessToken: "bad", expiresAt: Date.now() + 60_000 }),
    fetchImpl,
  })).rejects.toThrow("authenticated Spotify session");
});
