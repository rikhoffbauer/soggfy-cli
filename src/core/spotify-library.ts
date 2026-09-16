import {
  getAuthenticatedSpotifyWebToken,
  type SpotifyAuthenticatedWebToken,
} from "./spotify-renderer-auth";

const SPOTIFY_API = "https://api.spotify.com/v1";
const PAGE_LIMIT = 50;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export interface SpotifyLibraryTrack {
  id: string;
  uri: string;
  title: string;
  artists: string[];
  album: string;
  imageUrl?: string;
  durationMs?: number;
  playable: boolean;
}

export interface SpotifyLibraryIssue {
  index: number;
  reason: "unavailable" | "non-track" | "malformed";
}

export interface SpotifyLibraryPlaylist {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  imageUrl?: string;
  snapshotId?: string;
  tracks: SpotifyLibraryTrack[];
  issues: SpotifyLibraryIssue[];
  totalCount: number;
}
export interface SpotifyLibrarySnapshot {
  account: { id: string; displayName: string };
  likedSongs: {
    tracks: SpotifyLibraryTrack[];
    issues: SpotifyLibraryIssue[];
    totalCount: number;
  };
  playlists: SpotifyLibraryPlaylist[];
}

export interface SpotifyLibraryOptions {
  fetchImpl?: typeof fetch;
  tokenProvider?: () => Promise<SpotifyAuthenticatedWebToken>;
}

function object(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function firstImage(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    const url = object(candidate)?.url;
    if (typeof url === "string" && url) return url;
  }
  return undefined;
}

function normalizeTrack(value: unknown): SpotifyLibraryTrack | null {
  const item = object(value);
  if (!item) return null;
  if (item.type && item.type !== "track") return null;
  const id = typeof item.id === "string" ? item.id : "";
  const title = typeof item.name === "string" ? item.name : "";
  if (!SPOTIFY_ID.test(id) || !title) return null;
  const artists = Array.isArray(item.artists)
    ? item.artists.map((artist) => object(artist)?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
    : [];
  const album = object(item.album);
  const durationMs = Number(item.duration_ms);
  return {
    id,
    uri: typeof item.uri === "string" && item.uri ? item.uri : `spotify:track:${id}`,
    title,
    artists,
    album: typeof album?.name === "string" ? album.name : "Spotify",
    imageUrl: firstImage(album?.images),
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
    playable: item.is_playable !== false,
  };
}
async function spotifyJSON(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, any>> {
  const response = await fetchImpl(`${SPOTIFY_API}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Soggfy does not have an authenticated Spotify session with library access");
  }
  if (response.status === 429) {
    throw new Error("Spotify library request was rate limited");
  }
  if (!response.ok) {
    throw new Error(`Spotify library request failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  const mapped = object(payload);
  if (!mapped) throw new Error("Spotify library returned an invalid response");
  return mapped;
}

async function fetchPagedItems(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ items: unknown[]; total: number }> {
  const items: unknown[] = [];
  let offset = 0;
  let total = 0;
  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await spotifyJSON(
      `${path}${separator}limit=${PAGE_LIMIT}&offset=${offset}`,
      token,
      fetchImpl,
    );
    const pageItems = Array.isArray(page.items) ? page.items : [];
    if (Number.isFinite(Number(page.total))) total = Number(page.total);
    items.push(...pageItems);
    if (!page.next) break;
    if (pageItems.length === 0) throw new Error("Spotify library pagination did not advance");
    offset += pageItems.length;
  }
  return { items, total: Math.max(total, items.length) };
}

function classifyWrappedTrack(
  wrapper: unknown,
  index: number,
): { track?: SpotifyLibraryTrack; issue?: SpotifyLibraryIssue } {
  const record = object(wrapper);
  const raw = record?.item ?? record?.track;
  if (!raw) return { issue: { index, reason: "unavailable" } };
  const rawObject = object(raw);
  if (rawObject?.type && rawObject.type !== "track") {
    return { issue: { index, reason: "non-track" } };
  }
  const track = normalizeTrack(raw);
  return track ? { track } : { issue: { index, reason: "malformed" } };
}
export async function fetchSpotifyLibrarySnapshot(
  options: SpotifyLibraryOptions = {},
): Promise<SpotifyLibrarySnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenResult = await (options.tokenProvider
    ? options.tokenProvider()
    : getAuthenticatedSpotifyWebToken());
  const token = tokenResult.accessToken;

  const accountPayload = await spotifyJSON("/me", token, fetchImpl);
  const accountID = typeof accountPayload.id === "string" ? accountPayload.id : "";
  if (!accountID) throw new Error("Spotify account response did not contain an account ID");
  const displayName = typeof accountPayload.display_name === "string" && accountPayload.display_name
    ? accountPayload.display_name
    : accountID;

  const likedPage = await fetchPagedItems("/me/tracks", token, fetchImpl);
  const likedTracks: SpotifyLibraryTrack[] = [];
  const likedIssues: SpotifyLibraryIssue[] = [];
  likedPage.items.forEach((wrapper, index) => {
    const result = classifyWrappedTrack(wrapper, index);
    if (result.track) likedTracks.push(result.track);
    if (result.issue) likedIssues.push(result.issue);
  });

  const playlistPage = await fetchPagedItems("/me/playlists", token, fetchImpl);
  const playlists: SpotifyLibraryPlaylist[] = [];
  for (const rawPlaylist of playlistPage.items) {
    const playlist = object(rawPlaylist);
    const id = typeof playlist?.id === "string" ? playlist.id : "";
    if (!SPOTIFY_ID.test(id)) continue;
    const contents = await fetchPagedItems(`/playlists/${id}/items`, token, fetchImpl);
    const tracks: SpotifyLibraryTrack[] = [];
    const issues: SpotifyLibraryIssue[] = [];
    contents.items.forEach((wrapper, index) => {
      const result = classifyWrappedTrack(wrapper, index);
      if (result.track) tracks.push(result.track);
      if (result.issue) issues.push(result.issue);
    });
    const owner = object(playlist?.owner);
    playlists.push({
      id,
      name: typeof playlist?.name === "string" && playlist.name ? playlist.name : "Untitled playlist",
      description: typeof playlist?.description === "string" ? playlist.description : undefined,
      owner: typeof owner?.display_name === "string" ? owner.display_name : undefined,
      imageUrl: firstImage(playlist?.images),
      snapshotId: typeof playlist?.snapshot_id === "string" ? playlist.snapshot_id : undefined,
      tracks,
      issues,
      totalCount: contents.total,
    });
  }

  return {
    account: { id: accountID, displayName },
    likedSongs: { tracks: likedTracks, issues: likedIssues, totalCount: likedPage.total },
    playlists,
  };
}
