import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  buildSpotifyCookieHeader,
  getAuthenticatedSpotifyWebToken,
  type CDPCookie,
} from "../src/core/spotify-renderer-auth";

const originalSpotifyCookie = process.env.SPOTIFY_COOKIE;
beforeAll(() => { delete process.env.SPOTIFY_COOKIE; });
afterAll(() => {
  if (originalSpotifyCookie === undefined) delete process.env.SPOTIFY_COOKIE;
  else process.env.SPOTIFY_COOKIE = originalSpotifyCookie;
});

const cookies: CDPCookie[] = [
  { name: "sp_dc", value: "secret-session", domain: ".spotify.com", path: "/" },
  { name: "sp_key", value: "key-value", domain: "open.spotify.com", path: "/" },
  { name: "foreign", value: "do-not-send", domain: ".example.com", path: "/" },
];

test("renderer auth forwards only Spotify cookies and requires an authenticated session", () => {
  expect(buildSpotifyCookieHeader(cookies)).toBe("sp_dc=secret-session; sp_key=key-value");
  expect(() => buildSpotifyCookieHeader(cookies.filter((cookie) => cookie.name !== "sp_dc")))
    .toThrow("authenticated Spotify session");
});

test("renderer auth exchanges the managed Spotify session for a web access token", async () => {
  let requestCookie = "";
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestCookie = new Headers(init?.headers).get("cookie") ?? "";
    return new Response(JSON.stringify({
      accessToken: "spotify-access",
      accessTokenExpirationTimestampMs: Date.now() + 60_000,
    }));
  }) as typeof fetch;

  const result = await getAuthenticatedSpotifyWebToken({
    cookieProvider: async () => cookies,
    fetchImpl,
  });

  expect(result.accessToken).toBe("spotify-access");
  expect(result.expiresAt).toBeGreaterThan(Date.now());
  expect(requestCookie).toBe("sp_dc=secret-session; sp_key=key-value");
});


test("renderer auth can use the managed desktop renderer bearer token when no sp_dc cookie exists", async () => {
  let tokenExchangeCalls = 0;
  const result = await getAuthenticatedSpotifyWebToken({
    cookieProvider: async () => [],
    bearerTokenProvider: async () => "desktop-renderer-access",
    fetchImpl: (async () => {
      tokenExchangeCalls += 1;
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch,
    rendererSessionAttempts: 1,
    rendererSessionPollMs: 0,
  });

  expect(result.accessToken).toBe("desktop-renderer-access");
  expect(result.expiresAt).toBeGreaterThan(Date.now());
  expect(tokenExchangeCalls).toBe(0);
});

test("explicit Spotify cookie still takes precedence over renderer bearer fallback", async () => {
  process.env.SPOTIFY_COOKIE = "sp_dc=explicit-session";
  let bearerReads = 0;
  try {
    const result = await getAuthenticatedSpotifyWebToken({
      bearerTokenProvider: async () => { bearerReads += 1; return "renderer-token"; },
      fetchImpl: (async () => Response.json({
        accessToken: "cookie-exchanged-access",
        accessTokenExpirationTimestampMs: Date.now() + 60_000,
      })) as typeof fetch,
    });
    expect(result.accessToken).toBe("cookie-exchanged-access");
    expect(bearerReads).toBe(0);
  } finally {
    delete process.env.SPOTIFY_COOKIE;
  }
});

test("renderer auth waits for the managed Spotify session during startup", async () => {
  let cookieReads = 0;
  const fetchImpl = (async () => Response.json({
    accessToken: "spotify-access",
    accessTokenExpirationTimestampMs: Date.now() + 60_000,
  })) as typeof fetch;

  const result = await getAuthenticatedSpotifyWebToken({
    cookieProvider: async () => {
      cookieReads += 1;
      return cookieReads === 1
        ? cookies.filter((cookie) => cookie.name !== "sp_dc")
        : cookies;
    },
    fetchImpl,
    rendererSessionAttempts: 2,
    rendererSessionPollMs: 0,
  });

  expect(result.accessToken).toBe("spotify-access");
  expect(cookieReads).toBe(2);
});


test("renderer auth honors the shared Spotify TOTP version override", async () => {
  const previous = process.env.SPOTIFY_TOTP_VERSION;
  process.env.SPOTIFY_TOTP_VERSION = "77";
  let totpVersion = "";
  try {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      totpVersion = new URL(String(input)).searchParams.get("totpVer") ?? "";
      return Response.json({
        accessToken: "spotify-access",
        accessTokenExpirationTimestampMs: Date.now() + 60_000,
      });
    }) as typeof fetch;
    await getAuthenticatedSpotifyWebToken({
      cookieProvider: async () => cookies,
      fetchImpl,
    });
    expect(totpVersion).toBe("77");
  } finally {
    if (previous === undefined) delete process.env.SPOTIFY_TOTP_VERSION;
    else process.env.SPOTIFY_TOTP_VERSION = previous;
  }
});
