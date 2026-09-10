import { getSpotifyWebTokens, SPOTIFY_WEB_USER_AGENT } from "./spotify-web-auth";

const ALBUM_HASH = "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10";
const SPOTIFY_ID_RE = /^[a-zA-Z0-9]{22}$/;

export interface SpotifyAlbumPage {
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

function trackIdFromItem(value: unknown): string | null {
  const item = asObject(value);
  const candidates = [item?.track, item?.track?.data, item?.data, item];
  for (const candidate of candidates) {
    const object = asObject(candidate);
    const uri = typeof object?.uri === "string" ? object.uri : "";
    const id = uri.startsWith("spotify:track:") ? uri.slice(14) : object?.id;
    if (typeof id === "string" && SPOTIFY_ID_RE.test(id)) return id;
  }
  return null;
}export function normalizeSpotifyAlbumResponse(
  response: unknown,
  requestedOffset = 0,
  requestedLimit = 100,
): SpotifyAlbumPage {
  const data = asObject(response)?.data;
  const album = asObject(asObject(data)?.album) ?? asObject(asObject(data)?.albumUnion);
  if (!album) throw new Error("Spotify album response did not contain album data");

  const tracks = asObject(album.tracks) ?? asObject(album.content);
  const items = Array.isArray(tracks?.items) ? tracks.items : [];
  const paging = asObject(tracks?.pagingInfo);
  const offset = Number.isFinite(paging?.offset) ? Number(paging!.offset) : requestedOffset;
  const limit = Number.isFinite(paging?.limit) ? Number(paging!.limit) : requestedLimit;
  const totalCount = Number.isFinite(tracks?.totalCount)
    ? Number(tracks!.totalCount)
    : Number.isFinite(paging?.total)
      ? Number(paging!.total)
      : items.length;
  const trackIds = items.map(trackIdFromItem).filter((id): id is string => id !== null);
  const consumed = items.length;

  return {
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