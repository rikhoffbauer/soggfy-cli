import { getSpotifyWebTokens, SPOTIFY_WEB_USER_AGENT } from "./spotify-web-auth";

const ALBUM_HASH = "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10";
const SPOTIFY_ID_RE = /^[a-zA-Z0-9]{22}$/;

export interface SpotifyAlbumSummary {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  imageUrl?: string;
}

export interface SpotifyAlbumTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  imageUrl?: string;
  durationMs?: number;
  playable: boolean;
  sourceIndex: number;
}

export interface SpotifyAlbumPage {
  album: SpotifyAlbumSummary;
  tracks: SpotifyAlbumTrack[];
  trackIds: string[];
  offset: number;
  limit: number;
  totalCount: number;
  nextOffset: number | null;
}

export interface SpotifyAlbumOptions {
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
}

function artistNames(value: unknown): string[] {
  const items = asObject(value)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => asObject(item)?.profile?.name ?? asObject(item)?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

function trackDataFromItem(value: unknown): Record<string, any> | null {
  const item = asObject(value);
  const candidates = [item?.track, item?.track?.data, item?.item?.data, item?.data, item];
  for (const candidate of candidates) {
    const object = asObject(candidate);
    if (!object) continue;
    const uri = typeof object.uri === "string" ? object.uri : "";
    const id = uri.startsWith("spotify:track:") ? uri.slice(14) : object.id;
    if (typeof id === "string" && SPOTIFY_ID_RE.test(id)) return object;
  }
  return null;
}

function normalizeAlbumTrack(value: unknown, sourceIndex: number): SpotifyAlbumTrack | null {
  const data = trackDataFromItem(value);
  if (!data) return null;
  const uri = typeof data.uri === "string" && data.uri.startsWith("spotify:track:")
    ? data.uri
    : `spotify:track:${data.id}`;
  const id = uri.slice(14);
  const name = typeof data.name === "string" ? data.name : "";
  if (!SPOTIFY_ID_RE.test(id) || !name) return null;
  const duration = asObject(data.trackDuration)?.totalMilliseconds ?? asObject(data.duration)?.totalMilliseconds;
  const cover = asObject(data.albumOfTrack)?.coverArt;
  return {
    id, uri, name, artists: artistNames(data.artists),
    imageUrl: firstImage(asObject(cover)?.sources),
    durationMs: Number.isFinite(duration) ? Number(duration) : undefined,
    playable: asObject(data.playability)?.playable !== false,
    sourceIndex,
  };
}

function trackIdFromItem(value: unknown): string | null {
  return trackDataFromItem(value)?.uri?.startsWith("spotify:track:")
    ? trackDataFromItem(value)!.uri.slice(14)
    : typeof trackDataFromItem(value)?.id === "string" ? trackDataFromItem(value)!.id : null;
}

export function normalizeSpotifyAlbumResponse(
  response: unknown,
  requestedOffset = 0,
  requestedLimit = 100,
): SpotifyAlbumPage {
  const data = asObject(response)?.data;
  const album = asObject(asObject(data)?.album) ?? asObject(asObject(data)?.albumUnion);
  if (!album) throw new Error("Spotify album response did not contain album data");

  const trackSection = asObject(album.tracks) ?? asObject(album.content);
  const items = Array.isArray(trackSection?.items) ? trackSection.items : [];
  const paging = asObject(trackSection?.pagingInfo);
  const offset = Number.isFinite(paging?.offset) ? Number(paging!.offset) : requestedOffset;
  const limit = Number.isFinite(paging?.limit) ? Number(paging!.limit) : requestedLimit;
  const totalCount = Number.isFinite(trackSection?.totalCount)
    ? Number(trackSection!.totalCount)
    : Number.isFinite(paging?.total)
      ? Number(paging!.total)
      : items.length;
  const tracks = items
    .map((item, index) => normalizeAlbumTrack(item, offset + index))
    .filter((track): track is SpotifyAlbumTrack => track !== null);
  const trackIds = tracks.map((track) => track.id);
  const consumed = items.length;
  const uri = typeof album.uri === "string" ? album.uri : "";
  const id = uri.startsWith("spotify:album:") ? uri.slice(14) : typeof album.id === "string" ? album.id : "";
  if (!SPOTIFY_ID_RE.test(id)) throw new Error("Spotify album response did not contain a valid album ID");

  return {
    album: {
      id,
      uri: uri || `spotify:album:${id}`,
      name: typeof album.name === "string" && album.name ? album.name : "Untitled album",
      artists: artistNames(album.artists),
      imageUrl: firstImage(asObject(album.coverArt)?.sources),
    },
    tracks,
    trackIds,
    offset,
    limit,
    totalCount,
    nextOffset: offset + consumed < totalCount ? offset + consumed : null,
  };
}

function clampLimit(value = 100): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(300, Math.trunc(value)));
}export async function fetchSpotifyAlbumPage(
  id: string,
  options: SpotifyAlbumOptions = {},
): Promise<SpotifyAlbumPage> {
  const albumId = id.trim();
  if (!SPOTIFY_ID_RE.test(albumId)) throw new Error("Invalid Spotify album ID");
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.trunc(options.offset!)) : 0;
  const limit = clampLimit(options.limit);
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokens = await getSpotifyWebTokens(fetchImpl);
  const response = await fetchImpl("https://api-partner.spotify.com/pathfinder/v2/query", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${tokens.accessToken}`,
      "client-token": tokens.clientToken,
      "content-type": "application/json;charset=UTF-8",
      "user-agent": SPOTIFY_WEB_USER_AGENT,
    },
    body: JSON.stringify({
      variables: { uri: `spotify:album:${albumId}`, offset, limit },
      operationName: "queryAlbumTracks",
      extensions: { persistedQuery: { version: 1, sha256Hash: ALBUM_HASH } },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Spotify album request failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Spotify album returned invalid JSON: ${text.slice(0, 240)}`); }
  const errors = asObject(data)?.errors;
  if (Array.isArray(errors) && errors.length) {
    const message = asObject(errors[0])?.message;
    throw new Error(typeof message === "string" ? message : "Spotify album request failed");
  }
  return normalizeSpotifyAlbumResponse(data, offset, limit);
}export async function fetchAllSpotifyAlbumTrackIds(
  id: string,
  options: Omit<SpotifyAlbumOptions, "offset"> = {},
): Promise<string[]> {
  const ids: string[] = [];
  const limit = clampLimit(options.limit);
  let offset = 0;
  while (true) {
    const page = await fetchSpotifyAlbumPage(id, { ...options, offset, limit });
    ids.push(...page.trackIds);
    if (page.nextOffset === null) break;
    if (page.nextOffset <= offset) throw new Error("Spotify album pagination did not advance");
    offset = page.nextOffset;
  }
  return ids;
}