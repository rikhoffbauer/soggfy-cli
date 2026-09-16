import { createHmac, randomUUID } from "crypto";
import { SUPPORTED_SPOTIFY_VERSION } from "./spotify-runtime";

export interface SpotifyWebTokens {
  accessToken: string;
  clientToken: string;
  expiresAt: number;
}

const SPOTIFY_TOTP_VERSION = 61;
const SPOTIFY_TOTP_CIPHER_BYTES = [
  44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120,
  97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78,
] as const;
export const SPOTIFY_WEB_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
let cachedTokens: SpotifyWebTokens | null = null;

export function spotifyTotpVersion(): number {
  const value = Number.parseInt(process.env.SPOTIFY_TOTP_VERSION ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : SPOTIFY_TOTP_VERSION;
}

function spotifyTotpCipherBytes(): number[] {
  const override = process.env.SPOTIFY_TOTP_SECRET_CIPHER_BYTES?.trim();
  if (!override) return [...SPOTIFY_TOTP_CIPHER_BYTES];
  try {
    const value = JSON.parse(override);
    if (Array.isArray(value) && value.length > 0
        && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
      return value;
    }
  } catch {}
  const values = override.split(/[\s,]+/).filter(Boolean).map(Number);
  if (values.length > 0 && values.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return values;
  }
  throw new Error("SPOTIFY_TOTP_SECRET_CIPHER_BYTES must be a JSON array or comma-separated byte list");
}

export function generateSpotifyWebTOTP(nowMs = Date.now()): string {
  const secret = spotifyTotpCipherBytes()
    .map((value, index) => value ^ ((index % 33) + 9))
    .map(String).join("");
  const counter = BigInt(Math.floor(nowMs / 30_000));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", Buffer.from(secret, "utf8")).update(counterBytes).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return binary.toString().padStart(6, "0");
}

export function invalidateSpotifyWebTokens(): void {
  cachedTokens = null;
}
async function acquireSpotifyWebTokens(fetchImpl: typeof fetch): Promise<SpotifyWebTokens> {
  const directAccess = process.env.SPOTIFY_ACCESS_TOKEN;
  const directClient = process.env.SPOTIFY_CLIENT_TOKEN;
  if (directAccess && directClient) {
    return { accessToken: directAccess, clientToken: directClient, expiresAt: Date.now() + 50 * 60_000 };
  }

  const cookie = process.env.SPOTIFY_COOKIE?.trim();

  const totp = generateSpotifyWebTOTP();
  const tokenURL = new URL("https://open.spotify.com/api/token");
  tokenURL.searchParams.set("reason", "init");
  tokenURL.searchParams.set("productType", "web-player");
  tokenURL.searchParams.set("totp", totp);
  tokenURL.searchParams.set("totpServer", totp);
  tokenURL.searchParams.set("totpVer", String(spotifyTotpVersion()));
  const tokenHeaders: Record<string, string> = {
    Accept: "application/json",
    "App-Platform": "WebPlayer",
    Referer: "https://open.spotify.com/",
    "User-Agent": SPOTIFY_WEB_USER_AGENT,
  };
  if (cookie) tokenHeaders.Cookie = cookie;
  const tokenRes = await fetchImpl(tokenURL, { headers: tokenHeaders });
  if (!tokenRes.ok) throw new Error(`Spotify web token request failed with HTTP ${tokenRes.status}`);
  const tokenData: any = await tokenRes.json();
  if (!tokenData.accessToken || !tokenData.clientId) {
    throw new Error("Spotify web token response did not contain an access token and client id");
  }

  const clientTokenRes = await fetchImpl("https://clienttoken.spotify.com/v1/clienttoken", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_data: {
        client_version: SUPPORTED_SPOTIFY_VERSION,
        client_id: tokenData.clientId,
        js_sdk_data: {
          device_brand: "Apple",
          device_model: "Soggfy",
          os: "macos",
          os_version: "10.15.7",
          device_id: randomUUID(),
          device_type: "computer",
        },
      },
    }),
  });
  if (!clientTokenRes.ok) {
    throw new Error(`Spotify client-token request failed with HTTP ${clientTokenRes.status}`);
  }
  const clientTokenData: any = await clientTokenRes.json();
  const clientToken = clientTokenData.granted_token?.token;
  if (!clientToken) throw new Error("Spotify client-token response did not contain a token");
  return {
    accessToken: tokenData.accessToken,
    clientToken,
    expiresAt: tokenData.accessTokenExpirationTimestampMs
      ? tokenData.accessTokenExpirationTimestampMs - 60_000
      : Date.now() + 50 * 60_000,
  };
}

export async function getSpotifyWebTokens(fetchImpl: typeof fetch = fetch): Promise<SpotifyWebTokens> {
  if (cachedTokens && Date.now() < cachedTokens.expiresAt) return cachedTokens;
  cachedTokens = await acquireSpotifyWebTokens(fetchImpl);
  return cachedTokens;
}
