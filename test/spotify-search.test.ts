import { expect, test } from "bun:test";
import {
  normalizeSearchResponse, normalizeSearchTypes, clampSearchLimit,
  generateSpotifyWebTOTP, invalidateSpotifySearchTokens, searchSpotify,
} from "../src/core/spotify-search";

const response = {
  data: {
    searchV2: {
      tracks: { items: [{ item: { data: {
        id: "track1", uri: "spotify:track:track1", name: "Song One",
        artists: { items: [{ profile: { name: "Artist One" } }] },
        albumOfTrack: { coverArt: { sources: [{ url: "track.jpg" }] } },
      } } }] },
      albums: { items: [{ data: {
        id: "album1", uri: "spotify:album:album1", name: "Album One",
        artists: { items: [{ profile: { name: "Artist One" } }] },
        coverArt: { sources: [{ url: "album.jpg" }] },
      } }] },
      artists: { items: [{ data: {
        id: "artist1", uri: "spotify:artist:artist1",
        profile: { name: "Artist One" },
        visuals: { avatarImage: { sources: [{ url: "artist.jpg" }] } },
      } }] },
      playlists: { items: [{ data: {
        id: "playlist1", uri: "spotify:playlist:playlist1", name: "Playlist One",
        ownerV2: { data: { name: "Owner One" } },
        images: { items: [{ sources: [{ url: "playlist.jpg" }] }] },
      } }] },
    },
  },
};

test("normalizes track, album, artist, and playlist results", () => {
  expect(normalizeSearchResponse(response)).toEqual([
    { id: "track1", uri: "spotify:track:track1", type: "track", name: "Song One", subtitle: "Artist One", imageUrl: "track.jpg" },
    { id: "album1", uri: "spotify:album:album1", type: "album", name: "Album One", subtitle: "Artist One", imageUrl: "album.jpg" },
    { id: "artist1", uri: "spotify:artist:artist1", type: "artist", name: "Artist One", subtitle: "Artist", imageUrl: "artist.jpg" },
    { id: "playlist1", uri: "spotify:playlist:playlist1", type: "playlist", name: "Playlist One", subtitle: "Owner One", imageUrl: "playlist.jpg" },
  ]);
});

test("normalizes current tracksV2 search responses", () => {
  const current = structuredClone(response) as any;
  current.data.searchV2.tracksV2 = current.data.searchV2.tracks;
  delete current.data.searchV2.tracks;

  const tracks = normalizeSearchResponse(current).filter((item) => item.type === "track");

  expect(tracks).toHaveLength(1);
  expect(tracks[0]?.name).toBe("Song One");
});

test("normalization ignores malformed entries without discarding valid results", () => {
  const malformed = structuredClone(response) as any;
  malformed.data.searchV2.tracks.items.unshift({ item: { data: null } });
  malformed.data.searchV2.artists.items.unshift({ data: { uri: "spotify:artist:no-name" } });
  expect(normalizeSearchResponse(malformed).map((item) => item.id)).toEqual(["track1", "album1", "artist1", "playlist1"]);
});

test("search type and limit helpers are strict and deterministic", () => {
  expect(normalizeSearchTypes("all")).toEqual(["track", "album", "artist", "playlist"]);
  expect(normalizeSearchTypes("artist")).toEqual(["artist"]);
  expect(normalizeSearchTypes("album")).toEqual(["album"]);
  expect(clampSearchLimit(0)).toBe(1);
  expect(clampSearchLimit(500)).toBe(50);
  expect(clampSearchLimit(12)).toBe(12);
});


test("Spotify web TOTP v61 matches a deterministic vector", () => {
  expect(generateSpotifyWebTOTP(1_800_000_000_000)).toBe("346094");
});

test("cookie search acquires modern web and client tokens before Pathfinder", async () => {
  const saved = {
    access: process.env.SPOTIFY_ACCESS_TOKEN, client: process.env.SPOTIFY_CLIENT_TOKEN,
    cookie: process.env.SPOTIFY_COOKIE, version: process.env.SPOTIFY_TOTP_VERSION,
    cipher: process.env.SPOTIFY_TOTP_SECRET_CIPHER_BYTES,
  };
  delete process.env.SPOTIFY_ACCESS_TOKEN;
  delete process.env.SPOTIFY_CLIENT_TOKEN;
  process.env.SPOTIFY_COOKIE = "sp_dc=test-cookie";
  delete process.env.SPOTIFY_TOTP_VERSION;
  delete process.env.SPOTIFY_TOTP_SECRET_CIPHER_BYTES;
  invalidateSpotifySearchTokens();
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/api/token") return new Response(JSON.stringify({
      accessToken: "web-access", clientId: "web-client",
      accessTokenExpirationTimestampMs: Date.now() + 3_600_000,
    }));
    if (url.hostname === "clienttoken.spotify.com") return new Response(JSON.stringify({
      granted_token: { token: "client-token" },
    }));
    return new Response(JSON.stringify(response));
  }) as typeof fetch;
  try {
    await searchSpotify("one", { types: ["track"], limit: 5, fetchImpl });
    expect(calls).toHaveLength(3);
    const tokenURL = calls[0]!.url;
    expect(`${tokenURL.origin}${tokenURL.pathname}`).toBe("https://open.spotify.com/api/token");
    expect(tokenURL.searchParams.get("reason")).toBe("init");
    expect(tokenURL.searchParams.get("productType")).toBe("web-player");
    expect(tokenURL.searchParams.get("totpVer")).toBe("61");
    expect(tokenURL.searchParams.get("totp")).toMatch(/^\d{6}$/);
    expect(tokenURL.searchParams.get("totpServer")).toBe(tokenURL.searchParams.get("totp"));
    expect(new Headers(calls[0]!.init?.headers).get("Cookie")).toBe("sp_dc=test-cookie");
    expect(calls[1]!.url.href).toBe("https://clienttoken.spotify.com/v1/clienttoken");
    expect(JSON.parse(String(calls[1]!.init?.body)).client_data.client_id).toBe("web-client");
    const pathfinderHeaders = new Headers(calls[2]!.init?.headers);
    expect(pathfinderHeaders.get("authorization")).toBe("Bearer web-access");
    expect(pathfinderHeaders.get("client-token")).toBe("client-token");
  } finally {
    invalidateSpotifySearchTokens();
    const restore = (key: string, value: string | undefined) => value === undefined
      ? delete process.env[key] : void (process.env[key] = value);
    restore("SPOTIFY_ACCESS_TOKEN", saved.access); restore("SPOTIFY_CLIENT_TOKEN", saved.client);
    restore("SPOTIFY_COOKIE", saved.cookie); restore("SPOTIFY_TOTP_VERSION", saved.version);
    restore("SPOTIFY_TOTP_SECRET_CIPHER_BYTES", saved.cipher);
  }
});

test("searchSpotify filters result types using a supplied transport", async () => {
  const oldAccess = process.env.SPOTIFY_ACCESS_TOKEN;
  const oldClient = process.env.SPOTIFY_CLIENT_TOKEN;
  process.env.SPOTIFY_ACCESS_TOKEN = "access";
  process.env.SPOTIFY_CLIENT_TOKEN = "client";
  try {
    const { searchSpotify } = await import("../src/core/spotify-search");
    const results = await searchSpotify("one", {
      types: ["playlist"],
      limit: 5,
      fetchImpl: (async () => new Response(JSON.stringify(response), { status: 200 })) as typeof fetch,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe("playlist");
  } finally {
    if (oldAccess === undefined) delete process.env.SPOTIFY_ACCESS_TOKEN; else process.env.SPOTIFY_ACCESS_TOKEN = oldAccess;
    if (oldClient === undefined) delete process.env.SPOTIFY_CLIENT_TOKEN; else process.env.SPOTIFY_CLIENT_TOKEN = oldClient;
  }
});


test("searchSpotify retries one transient Pathfinder failure", async () => {
  const oldAccess = process.env.SPOTIFY_ACCESS_TOKEN;
  const oldClient = process.env.SPOTIFY_CLIENT_TOKEN;
  process.env.SPOTIFY_ACCESS_TOKEN = "access";
  process.env.SPOTIFY_CLIENT_TOKEN = "client";
  invalidateSpotifySearchTokens();
  let attempts = 0;
  try {
    const results = await searchSpotify("one", { types: ["track"], limit: 5, fetchImpl: (async () => {
      attempts += 1;
      return attempts === 1 ? new Response("temporary", { status: 503 }) : new Response(JSON.stringify(response));
    }) as typeof fetch });
    expect(attempts).toBe(2);
    expect(results).toHaveLength(1);
  } finally {
    invalidateSpotifySearchTokens();
    if (oldAccess === undefined) delete process.env.SPOTIFY_ACCESS_TOKEN; else process.env.SPOTIFY_ACCESS_TOKEN = oldAccess;
    if (oldClient === undefined) delete process.env.SPOTIFY_CLIENT_TOKEN; else process.env.SPOTIFY_CLIENT_TOKEN = oldClient;
  }
});

test("searchSpotify does not retry deterministic client errors", async () => {
  const oldAccess = process.env.SPOTIFY_ACCESS_TOKEN;
  const oldClient = process.env.SPOTIFY_CLIENT_TOKEN;
  process.env.SPOTIFY_ACCESS_TOKEN = "access";
  process.env.SPOTIFY_CLIENT_TOKEN = "client";
  invalidateSpotifySearchTokens();
  let attempts = 0;
  try {
    await expect(searchSpotify("one", { types: ["track"], fetchImpl: (async () => { attempts += 1; return new Response("bad", { status: 400 }); }) as typeof fetch })).rejects.toThrow("HTTP 400");
    expect(attempts).toBe(1);
  } finally {
    invalidateSpotifySearchTokens();
    if (oldAccess === undefined) delete process.env.SPOTIFY_ACCESS_TOKEN; else process.env.SPOTIFY_ACCESS_TOKEN = oldAccess;
    if (oldClient === undefined) delete process.env.SPOTIFY_CLIENT_TOKEN; else process.env.SPOTIFY_CLIENT_TOKEN = oldClient;
  }
});

test("searchSpotify forwards an explicit result offset to Pathfinder", async () => {
  const oldAccess = process.env.SPOTIFY_ACCESS_TOKEN;
  const oldClient = process.env.SPOTIFY_CLIENT_TOKEN;
  process.env.SPOTIFY_ACCESS_TOKEN = "access";
  process.env.SPOTIFY_CLIENT_TOKEN = "client";
  invalidateSpotifySearchTokens();
  let requestBody: any;
  try {
    await searchSpotify("one", {
      types: ["track"], limit: 5, offset: 25,
      fetchImpl: (async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(response), { status: 200 });
      }) as typeof fetch,
    });
    expect(requestBody.variables.offset).toBe(25);
  } finally {
    invalidateSpotifySearchTokens();
    if (oldAccess === undefined) delete process.env.SPOTIFY_ACCESS_TOKEN; else process.env.SPOTIFY_ACCESS_TOKEN = oldAccess;
    if (oldClient === undefined) delete process.env.SPOTIFY_CLIENT_TOKEN; else process.env.SPOTIFY_CLIENT_TOKEN = oldClient;
  }
});

test("anonymous search retries a transient web token network failure", async () => {
  const saved = {
    access: process.env.SPOTIFY_ACCESS_TOKEN,
    client: process.env.SPOTIFY_CLIENT_TOKEN,
    cookie: process.env.SPOTIFY_COOKIE,
  };
  delete process.env.SPOTIFY_ACCESS_TOKEN;
  delete process.env.SPOTIFY_CLIENT_TOKEN;
  delete process.env.SPOTIFY_COOKIE;
  invalidateSpotifySearchTokens();
  let tokenAttempts = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/token") {
      tokenAttempts += 1;
      if (tokenAttempts === 1) throw new TypeError("socket connection closed");
      return Response.json({
        accessToken: "anonymous-access", clientId: "web-client", isAnonymous: true,
        accessTokenExpirationTimestampMs: Date.now() + 3_600_000,
      });
    }
    if (url.hostname === "clienttoken.spotify.com") {
      return Response.json({ granted_token: { token: "client-token" } });
    }
    return Response.json(response);
  }) as typeof fetch;
  try {
    const results = await searchSpotify("one", { types: ["track"], limit: 5, fetchImpl });
    expect(results).toHaveLength(1);
    expect(tokenAttempts).toBe(2);
  } finally {
    invalidateSpotifySearchTokens();
    const restore = (key: string, value: string | undefined) => value === undefined
      ? delete process.env[key] : void (process.env[key] = value);
    restore("SPOTIFY_ACCESS_TOKEN", saved.access);
    restore("SPOTIFY_CLIENT_TOKEN", saved.client);
    restore("SPOTIFY_COOKIE", saved.cookie);
  }
});

test("anonymous search acquires web and client tokens without a Spotify cookie", async () => {
  const saved = {
    access: process.env.SPOTIFY_ACCESS_TOKEN,
    client: process.env.SPOTIFY_CLIENT_TOKEN,
    cookie: process.env.SPOTIFY_COOKIE,
  };
  delete process.env.SPOTIFY_ACCESS_TOKEN;
  delete process.env.SPOTIFY_CLIENT_TOKEN;
  delete process.env.SPOTIFY_COOKIE;
  invalidateSpotifySearchTokens();
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/api/token") return new Response(JSON.stringify({
      accessToken: "anonymous-access", clientId: "web-client", isAnonymous: true,
      accessTokenExpirationTimestampMs: Date.now() + 3_600_000,
    }));
    if (url.hostname === "clienttoken.spotify.com") return new Response(JSON.stringify({ granted_token: { token: "client-token" } }));
    return new Response(JSON.stringify(response));
  }) as typeof fetch;
  try {
    const results = await searchSpotify("one", { types: ["track"], limit: 5, fetchImpl });
    expect(results).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(new Headers(calls[0]!.init?.headers).get("Cookie")).toBeNull();
    expect(calls[0]!.url.pathname).toBe("/api/token");
    expect(calls[1]!.url.hostname).toBe("clienttoken.spotify.com");
  } finally {
    invalidateSpotifySearchTokens();
    const restore = (key: string, value: string | undefined) => value === undefined
      ? delete process.env[key] : void (process.env[key] = value);
    restore("SPOTIFY_ACCESS_TOKEN", saved.access);
    restore("SPOTIFY_CLIENT_TOKEN", saved.client);
    restore("SPOTIFY_COOKIE", saved.cookie);
  }
});
