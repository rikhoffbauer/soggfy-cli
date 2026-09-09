import { getSpotifyWebTokens, SPOTIFY_WEB_USER_AGENT } from "./spotify-web-auth";

const PLAYLIST_HASH = "86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0";
const PLAYLIST_ID_RE = /^[a-zA-Z0-9]{22}$/;

export interface SpotifyPlaylistTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  imageUrl?: string;
  durationMs?: number;
  playable: boolean;
  sourceIndex: number;
}

export interface SpotifyPlaylistIssue {
  index: number;
  reason: "unavailable" | "non-track" | "malformed";
}

export interface SpotifyPlaylistSummary {
  id: string;
  uri: string;
  name: string;
  owner: string;
  description?: string;
  imageUrl?: string;
}export interface SpotifyPlaylistPage {
  playlist: SpotifyPlaylistSummary;
  tracks: SpotifyPlaylistTrack[];
  issues: SpotifyPlaylistIssue[];
  offset: number;
  limit: number;
  totalCount: number;
  nextOffset: number | null;
}

export interface SpotifyPlaylistOptions {
  offset?: number;
  limit?: number;
  fetchImpl?: typeof fetch;
}

function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function firstImage(sources: unknown): string | undefined {
  if (!Array.isArray(sources)) return undefined;
  for (const source of sources) {
    const url = asObject(source)?.url;
    if (typeof url === "string" && url) return url;
  }
  return undefined;
}function playlistImage(playlist: Record<string, any>): string | undefined {
  const groups = asObject(playlist.images)?.items;
  if (Array.isArray(groups)) {
    for (const group of groups) {
      const url = firstImage(asObject(group)?.sources);
      if (url) return url;
    }
  }
  const visual = asObject(asObject(playlist.visualIdentity)?.squareCoverImage);
  return firstImage(asObject(asObject(visual)?.image)?.data?.sources);
}

function normalizeTrack(data: Record<string, any>, sourceIndex: number): SpotifyPlaylistTrack | null {
  if (data.__typename && data.__typename !== "Track") return null;
  const uri = typeof data.uri === "string" ? data.uri : "";
  const id = uri.startsWith("spotify:track:") ? uri.slice("spotify:track:".length) : "";
  const name = typeof data.name === "string" ? data.name : "";
  if (!PLAYLIST_ID_RE.test(id) || !name) return null;
  const artistItems = asObject(data.artists)?.items;
  const artists = Array.isArray(artistItems)
    ? artistItems.map((item) => asObject(item)?.profile?.name)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const cover = asObject(data.albumOfTrack)?.coverArt;
  const duration = asObject(data.trackDuration)?.totalMilliseconds;
  return {
    id, uri, name, artists,
    imageUrl: firstImage(asObject(cover)?.sources),
    durationMs: Number.isFinite(duration) ? Number(duration) : undefined,
    playable: asObject(data.playability)?.playable !== false,
    sourceIndex,
  };
}export function normalizeSpotifyPlaylistResponse(
  response: unknown,
  requestedOffset = 0,
  requestedLimit = 100,
): SpotifyPlaylistPage {
  const playlist = asObject(asObject(response)?.data)?.playlistV2;
  const root = asObject(playlist);
  if (!root || root.__typename === "NotFound") throw new Error("Spotify playlist not found");
  const uri = typeof root.uri === "string" ? root.uri : "";
  const id = uri.startsWith("spotify:playlist:") ? uri.slice("spotify:playlist:".length) : "";
  if (!PLAYLIST_ID_RE.test(id)) throw new Error("Spotify playlist response did not contain a valid playlist ID");

  const content = asObject(root.content);
  const rawItems = Array.isArray(content?.items) ? content.items : [];
  const paging = asObject(content?.pagingInfo);
  const offset = Number.isFinite(paging?.offset) ? Number(paging!.offset) : requestedOffset;
  const limit = Number.isFinite(paging?.limit) ? Number(paging!.limit) : requestedLimit;
  const totalCount = Number.isFinite(content?.totalCount) ? Number(content!.totalCount) : rawItems.length;
  const tracks: SpotifyPlaylistTrack[] = [];
  const issues: SpotifyPlaylistIssue[] = [];

  rawItems.forEach((item, index) => {
    const sourceIndex = offset + index;
    const wrapper = asObject(item);
    const itemV2 = asObject(wrapper?.itemV2);
    const data = asObject(itemV2?.data);
    if (!data) {
      issues.push({ index: sourceIndex, reason: "unavailable" });
      return;
    }
    if (data.__typename && data.__typename !== "Track") {
      issues.push({ index: sourceIndex, reason: "non-track" });
      return;
    }    const normalized = normalizeTrack(data, sourceIndex);
    if (normalized) tracks.push(normalized);
    else issues.push({ index: sourceIndex, reason: "malformed" });
  });

  const owner = asObject(root.ownerV2)?.data ?? asObject(root.owner);
  return {
    playlist: {
      id,
      uri,
      name: typeof root.name === "string" && root.name ? root.name : "Untitled playlist",
      owner: typeof owner?.name === "string" ? owner.name : "Unknown owner",
      description: typeof root.description === "string" ? root.description : undefined,
      imageUrl: playlistImage(root),
    },
    tracks,
    issues,
    offset,
    limit,
    totalCount,
    nextOffset: offset + rawItems.length < totalCount ? offset + rawItems.length : null,
  };
}

function clampLimit(value = 100): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function validPlaylistId(id: string): string {
  const trimmed = id.trim();
  if (!PLAYLIST_ID_RE.test(trimmed)) throw new Error("Invalid Spotify playlist ID");
  return trimmed;
}export async function fetchSpotifyPlaylistPage(
  id: string,
  options: SpotifyPlaylistOptions = {},
): Promise<SpotifyPlaylistPage> {
  const playlistId = validPlaylistId(id);
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.trunc(options.offset!)) : 0;
  const limit = clampLimit(options.limit);
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokens = await getSpotifyWebTokens(fetchImpl);
  const body = {
    variables: {
      uri: `spotify:playlist:${playlistId}`,
      offset,
      limit,
      enableWatchFeedEntrypoint: false,
      includeEpisodeContentRatingsV2: true,
    },
    operationName: "fetchPlaylist",
    extensions: { persistedQuery: { version: 1, sha256Hash: PLAYLIST_HASH } },
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
  });  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Spotify playlist request failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Spotify playlist returned invalid JSON: ${text.slice(0, 240)}`);
  }
  const errors = asObject(data)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const message = asObject(errors[0])?.message;
    throw new Error(typeof message === "string" ? message : "Spotify playlist request failed");
  }
  return normalizeSpotifyPlaylistResponse(data, offset, limit);
}

export async function fetchAllSpotifyPlaylistTracks(
  id: string,
  options: Omit<SpotifyPlaylistOptions, "offset"> = {},
): Promise<Omit<SpotifyPlaylistPage, "offset" | "limit" | "nextOffset">> {
  const tracks: SpotifyPlaylistTrack[] = [];
  const issues: SpotifyPlaylistIssue[] = [];
  const limit = clampLimit(options.limit);
  let offset = 0;
  let first: SpotifyPlaylistPage | null = null;

  while (true) {
    const page = await fetchSpotifyPlaylistPage(id, { ...options, offset, limit });
    if (!first) first = page;
    tracks.push(...page.tracks);
    issues.push(...page.issues);
    if (page.nextOffset === null) break;
    if (page.nextOffset <= offset) throw new Error("Spotify playlist pagination did not advance");
    offset = page.nextOffset;
  }  if (!first) throw new Error("Spotify playlist returned no pages");
  return {
    playlist: first.playlist,
    tracks,
    issues,
    totalCount: first.totalCount,
  };
}
