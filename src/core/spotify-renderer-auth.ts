import { generateSpotifyWebTOTP, spotifyTotpVersion, SPOTIFY_WEB_USER_AGENT } from "./spotify-web-auth";

export interface CDPCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

export interface SpotifyAuthenticatedWebToken {
  accessToken: string;
  expiresAt: number;
}

export interface SpotifyRendererAuthOptions {
  debugPort?: number;
  cookieProvider?: () => Promise<CDPCookie[]>;
  fetchImpl?: typeof fetch;
  rendererSessionAttempts?: number;
  rendererSessionPollMs?: number;
}

function isSpotifyDomain(domain: string): boolean {
  const normalized = domain.trim().replace(/^\./, "").toLowerCase();
  return normalized === "spotify.com" || normalized.endsWith(".spotify.com");
}

export function buildSpotifyCookieHeader(cookies: CDPCookie[]): string {
  const spotifyCookies = cookies.filter((cookie) =>
    cookie.name && cookie.value && isSpotifyDomain(cookie.domain)
  );
  if (!spotifyCookies.some((cookie) => cookie.name === "sp_dc")) {
    throw new Error("Soggfy renderer does not contain an authenticated Spotify session");
  }
  return spotifyCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
interface CDPTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
  url?: string;
}

async function readCDPCookies(webSocketURL: string): Promise<CDPCookie[]> {
  return await new Promise<CDPCookie[]>((resolve, reject) => {
    const socket = new WebSocket(webSocketURL);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Spotify renderer cookie request timed out"));
    }, 3_000);

    const finish = (action: () => void) => {
      clearTimeout(timeout);
      try { socket.close(); } catch {}
      action();
    };

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }));
    });
    socket.addEventListener("error", () => {
      finish(() => reject(new Error("Could not connect to the Soggfy Spotify renderer")));
    });
    socket.addEventListener("message", (event) => {
      let payload: any;
      try { payload = JSON.parse(String(event.data)); } catch { return; }
      if (payload?.id !== 1) return;
      if (payload.error) {
        finish(() => reject(new Error("Spotify renderer refused the cookie request")));
        return;
      }
      const cookies = Array.isArray(payload?.result?.cookies) ? payload.result.cookies : [];
      finish(() => resolve(cookies));
    });
  });
}

export async function readSpotifyRendererCookies(
  debugPort: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CDPCookie[]> {
  const response = await fetchImpl(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`Spotify renderer discovery failed with HTTP ${response.status}`);
  const targets = await response.json() as CDPTarget[];
  const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl)
    ?? targets.find((item) => item.webSocketDebuggerUrl);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("Soggfy Spotify renderer has no debuggable page target");
  }
  return readCDPCookies(target.webSocketDebuggerUrl);
}
export function defaultSpotifyRendererDebugPort(): number {
  const base = Number.parseInt(process.env.SOGGFY_DEBUG_PORT_BASE ?? "9223", 10);
  return (Number.isInteger(base) && base > 0 ? base : 9223) + 1;
}

function explicitSpotifyCookie(): string | null {
  const value = process.env.SPOTIFY_COOKIE?.trim();
  if (!value) return null;
  if (!/(?:^|;\s*)sp_dc=/.test(value)) {
    throw new Error("SPOTIFY_COOKIE does not contain an authenticated Spotify session");
  }
  return value;
}

async function waitForAuthenticatedRendererCookie(
  provider: () => Promise<CDPCookie[]>,
  attempts: number,
  pollMs: number,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return buildSpotifyCookieHeader(await provider());
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts && pollMs > 0) await Bun.sleep(pollMs);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Soggfy renderer does not contain an authenticated Spotify session");
}

export async function getAuthenticatedSpotifyWebToken(
  options: SpotifyRendererAuthOptions = {},
): Promise<SpotifyAuthenticatedWebToken> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const explicit = explicitSpotifyCookie();
  const rendererCookieProvider = options.cookieProvider
    ?? (() => readSpotifyRendererCookies(
      options.debugPort ?? defaultSpotifyRendererDebugPort(), fetchImpl
    ));
  const attempts = Math.max(1, options.rendererSessionAttempts ?? 20);
  const pollMs = Math.max(0, options.rendererSessionPollMs ?? 250);
  const cookies = explicit
    ?? await waitForAuthenticatedRendererCookie(rendererCookieProvider, attempts, pollMs);

  const totp = generateSpotifyWebTOTP();
  const url = new URL("https://open.spotify.com/api/token");
  url.searchParams.set("reason", "init");
  url.searchParams.set("productType", "web-player");
  url.searchParams.set("totp", totp);
  url.searchParams.set("totpServer", totp);
  url.searchParams.set("totpVer", String(spotifyTotpVersion()));
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "App-Platform": "WebPlayer",
      Cookie: cookies,
      Referer: "https://open.spotify.com/",
      "User-Agent": SPOTIFY_WEB_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Authenticated Spotify token request failed with HTTP ${response.status}`);
  }
  const payload: any = await response.json();
  if (typeof payload?.accessToken !== "string" || !payload.accessToken) {
    throw new Error("Authenticated Spotify token response did not contain an access token");
  }
  const expiresAt = Number(payload.accessTokenExpirationTimestampMs);
  return {
    accessToken: payload.accessToken,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt - 30_000 : Date.now() + 50 * 60_000,
  };
}
