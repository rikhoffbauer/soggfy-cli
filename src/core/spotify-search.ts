import { generateSpotifyWebTOTP, getSpotifyWebTokens, invalidateSpotifyWebTokens, SPOTIFY_WEB_USER_AGENT } from "./spotify-web-auth";

export { generateSpotifyWebTOTP };
export const invalidateSpotifySearchTokens = invalidateSpotifyWebTokens;

const SEARCH_HASH = "eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0";

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
  offset?: number;
  fetchImpl?: typeof fetch;
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

export async function searchSpotify(query: string, options: SpotifySearchOptions = {}): Promise<SpotifySearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Search query is required");
  const fetchImpl = options.fetchImpl ?? fetch;
  const types = options.types?.length ? [...options.types] : normalizeSearchTypes("all");
  const limit = clampSearchLimit(options.limit ?? 10);
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.trunc(options.offset!)) : 0;
  const tokens = await getSpotifyWebTokens(fetchImpl);
  const body = {
    variables: {
      searchTerm: trimmed,
      offset,
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
      "user-agent": SPOTIFY_WEB_USER_AGENT,
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
