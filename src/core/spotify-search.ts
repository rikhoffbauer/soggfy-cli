import { createHmac, randomUUID } from "crypto";
import { SUPPORTED_SPOTIFY_VERSION } from "./spotify-runtime";

export type SpotifySearchType = "track" | "artist" | "playlist";

export interface SpotifySearchResult {
  id: string;
  uri: string;
  type: SpotifySearchType;
  name: string;
  subtitle: string;
  imageUrl?: string;
}

export interface SpotifySearchOptions {
  types?: readonly SpotifySearchType[];
  limit?: number;
  fetchImpl?: typeof fetch;
}

interface SearchTokens {
  accessToken: string;
  clientToken: string;
  expiresAt: number;
}

const SEARCH_HASH = "eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0";
const SPOTIFY_TOTP_VERSION = 61;
const SPOTIFY_TOTP_CIPHER_BYTES = [
  44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120,
  97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78,
] as const;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
let cachedTokens: SearchTokens | null = null;

function spotifyTotpVersion(): number {
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

export function invalidateSpotifySearchTokens(): void {
  cachedTokens = null;
}

export function normalizeSearchTypes(value = "all"): SpotifySearchType[] {
  if (value === "all") return ["track", "artist", "playlist"];
  if (value === "track" || value === "artist" || value === "playlist") return [value];
  throw new Error(`Unsupported search type: ${value}`);
}

export function clampSearchLimit(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(50, Math.trunc(value)));
}

function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function itemData(wrapper: unknown): Record<string, any> | null {
  const root = asObject(wrapper);
  if (!root) return null;
  return asObject(root.item)?.data ?? asObject(root.item)?.item?.data ?? root.data ?? root;
}

function idFrom(uri: unknown, explicit: unknown): string | null {
  if (typeof explicit === "string" && explicit) return explicit;
  if (typeof uri === "string" && uri.includes(":")) return uri.split(":").pop() || null;
  return null;
}

function firstSourceUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = asObject(entry)?.url;
      if (typeof url === "string" && url) return url;
    }
  }
  return undefined;
}

function normalizeTrack(wrapper: unknown): SpotifySearchResult | null {
  const data = itemData(wrapper);
  if (!data) return null;
  const uri = typeof data.uri === "string" ? data.uri : undefined;
  const id = idFrom(uri, data.id);
  const name = typeof data.name === "string" ? data.name : undefined;
  if (!id || !name) return null;
  const artists = asObject(data.artists)?.items;
  const artistNames = Array.isArray(artists)
    ? artists.map((entry) => asObject(entry)?.profile?.name).filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const cover = asObject(data.albumOfTrack)?.coverArt;
  return {
    id,
    uri: uri || `spotify:track:${id}`,
    type: "track",
    name,
    subtitle: artistNames.join(", ") || "Unknown artist",
    imageUrl: firstSourceUrl(asObject(cover)?.sources),
  };
}

function normalizeArtist(wrapper: unknown): SpotifySearchResult | null {
  const data = itemData(wrapper);
  if (!data) return null;
  const uri = typeof data.uri === "string" ? data.uri : undefined;
  const id = idFrom(uri, data.id);
  const profile = asObject(data.profile);
  const name = typeof profile?.name === "string" ? profile.name : typeof data.name === "string" ? data.name : undefined;
  if (!id || !name) return null;
  const avatar = asObject(asObject(data.visuals)?.avatarImage) ?? asObject(profile?.avatar);
  return {
    id,
    uri: uri || `spotify:artist:${id}`,
    type: "artist",
    name,
    subtitle: "Artist",
    imageUrl: firstSourceUrl(avatar?.sources),
  };
}

function playlistImage(data: Record<string, any>): string | undefined {
  const imageGroups = asObject(data.images)?.items;
  if (Array.isArray(imageGroups)) {
    for (const group of imageGroups) {
      const url = firstSourceUrl(asObject(group)?.sources);
      if (url) return url;
    }
  }
  return firstSourceUrl(data.images);
}

function normalizePlaylist(wrapper: unknown): SpotifySearchResult | null {
  const data = itemData(wrapper);
  if (!data) return null;
  const uri = typeof data.uri === "string" ? data.uri : undefined;
  const id = idFrom(uri, data.id);
  const name = typeof data.name === "string" ? data.name : undefined;
  if (!id || !name) return null;
  const owner = asObject(data.ownerV2)?.data ?? asObject(data.owner)?.data ?? asObject(data.owner);
  const ownerName = typeof owner?.name === "string"
    ? owner.name
    : typeof owner?.display_name === "string"
      ? owner.display_name
      : "Playlist";
  return {
    id,
    uri: uri || `spotify:playlist:${id}`,
    type: "playlist",
    name,
    subtitle: ownerName,
    imageUrl: playlistImage(data),
  };
}

export function normalizeSearchResponse(response: unknown): SpotifySearchResult[] {
  const search = asObject(asObject(asObject(response)?.data)?.searchV2);
  if (!search) return [];
  const results: SpotifySearchResult[] = [];
  for (const [keys, normalize] of [
    [["tracksV2", "tracks"], normalizeTrack],
    [["artists"], normalizeArtist],
    [["playlists"], normalizePlaylist],
  ] as const) {
    const section = keys.map((key) => asObject(search[key])).find(Boolean);
    const items = section?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const normalized = normalize(item);
      if (normalized) results.push(normalized);
    }
  }
  return results;
}

async function acquireSearchTokens(fetchImpl: typeof fetch): Promise<SearchTokens> {
  const directAccess = process.env.SPOTIFY_ACCESS_TOKEN;
  const directClient = process.env.SPOTIFY_CLIENT_TOKEN;
  if (directAccess && directClient) {
    return { accessToken: directAccess, clientToken: directClient, expiresAt: Date.now() + 50 * 60_000 };
  }

  const cookie = process.env.SPOTIFY_COOKIE;
  if (!cookie?.includes("sp_dc=")) {
    throw new Error(
      "Spotify search requires SPOTIFY_COOKIE containing sp_dc=... or both SPOTIFY_ACCESS_TOKEN and SPOTIFY_CLIENT_TOKEN",
    );
  }

  const totp = generateSpotifyWebTOTP();
  const tokenURL = new URL("https://open.spotify.com/api/token");
  tokenURL.searchParams.set("reason", "init");
  tokenURL.searchParams.set("productType", "web-player");
  tokenURL.searchParams.set("totp", totp);
  tokenURL.searchParams.set("totpServer", totp);
  tokenURL.searchParams.set("totpVer", String(spotifyTotpVersion()));
  const tokenRes = await fetchImpl(tokenURL, {
    headers: {
      Accept: "application/json",
      "App-Platform": "WebPlayer",
      Cookie: cookie,
      Referer: "https://open.spotify.com/",
      "User-Agent": USER_AGENT,
    },
  });
  if (!tokenRes.ok) {
    throw new Error(`Spotify web token request failed with HTTP ${tokenRes.status}`);
  }
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

async function getSearchTokens(fetchImpl: typeof fetch): Promise<SearchTokens> {
  if (cachedTokens && Date.now() < cachedTokens.expiresAt) return cachedTokens;
  cachedTokens = await acquireSearchTokens(fetchImpl);
  return cachedTokens;
}

export async function searchSpotify(query: string, options: SpotifySearchOptions = {}): Promise<SpotifySearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Search query is required");
  const fetchImpl = options.fetchImpl ?? fetch;
  const types = options.types?.length ? [...options.types] : normalizeSearchTypes("all");
  const limit = clampSearchLimit(options.limit ?? 10);
  const tokens = await getSearchTokens(fetchImpl);
  const body = {
    variables: {
      searchTerm: trimmed,
      offset: 0,
      limit,
      numberOfTopResults: Math.min(limit, 5),
      includeAudiobooks: false,
      includeArtistHasConcertsField: false,
      includePreReleases: true,
      includeAlbumPreReleases: false,
      includeAuthors: false,
      includeEpisodeContentRatingsV2: false,
      isPrefix: null,
      sectionFilters: ["GENERIC"],
    },
    operationName: "searchDesktop",
    extensions: { persistedQuery: { version: 1, sha256Hash: SEARCH_HASH } },
  };

  const response = await fetchImpl("https://api-partner.spotify.com/pathfinder/v2/query", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${tokens.accessToken}`,
      "client-token": tokens.clientToken,
      "content-type": "application/json;charset=UTF-8",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Spotify search failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Spotify search returned invalid JSON: ${text.slice(0, 240)}`);
  }
  const errors = asObject(data)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const message = asObject(errors[0])?.message;
    throw new Error(typeof message === "string" ? message : "Spotify search failed");
  }
  return normalizeSearchResponse(data)
    .filter((result) => types.includes(result.type))
    .slice(0, limit * types.length);
}

export function groupSearchResults(results: readonly SpotifySearchResult[]) {
  const byType = (type: SpotifySearchType) => results.filter((item) => item.type === type);
  return {
    results,
    tracks: { items: byType("track") },
    artists: { items: byType("artist") },
    playlists: { items: byType("playlist") },
    albums: { items: [] as SpotifySearchResult[] },
  };
}
