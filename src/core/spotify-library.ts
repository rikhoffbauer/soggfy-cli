import {
  getAuthenticatedSpotifyWebToken,
  type SpotifyAuthenticatedWebToken,
} from "./spotify-renderer-auth";
import {
  fetchSpotifyRendererLibraryPayload,
  type SpotifyRendererLibraryPayload,
} from "./spotify-renderer-library";

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
  contentsAvailable: boolean;
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
  rendererProvider?: () => Promise<SpotifyRendererLibraryPayload>;
}

class SpotifyLibraryHTTPError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "SpotifyLibraryHTTPError";
  }
}

function object(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function spotifyImageURL(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (value.startsWith("spotify:image:")) {
    const hash = value.slice("spotify:image:".length);
    return hash ? `https://i.scdn.co/image/${hash}` : undefined;
  }
  if (value.startsWith("spotify:mosaic:")) {
    const hashes = value.slice("spotify:mosaic:".length).split(":").filter(Boolean);
    return hashes.length ? `https://mosaic.scdn.co/640/${hashes.join("")}` : undefined;
  }
  return value;
}

function firstImage(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    const url = spotifyImageURL(object(candidate)?.url);
    if (url) return url;
  }
  return undefined;
}

function spotifyIDFromURI(uri: unknown, kind: string): string {
  if (typeof uri !== "string") return "";
  const prefix = `spotify:${kind}:`;
  const id = uri.startsWith(prefix) ? uri.slice(prefix.length) : "";
  return SPOTIFY_ID.test(id) ? id : "";
}

function normalizeTrack(value: unknown): SpotifyLibraryTrack | null {
  const item = object(value);
  if (!item) return null;
  if (item.type && item.type !== "track") return null;
  const uri = typeof item.uri === "string" ? item.uri : "";
  const id = typeof item.id === "string" && SPOTIFY_ID.test(item.id)
    ? item.id
    : spotifyIDFromURI(uri, "track");
  const title = typeof item.name === "string" ? item.name : "";
  if (!id || !title) return null;
  const artists = Array.isArray(item.artists)
    ? item.artists.map((artist) => object(artist)?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
    : [];
  const album = object(item.album);
  const durationMs = Number(item.duration_ms ?? object(item.duration)?.milliseconds);
  return {
    id,
    uri: uri || `spotify:track:${id}`,
    title,
    artists,
    album: typeof album?.name === "string" ? album.name : "Spotify",
    imageUrl: firstImage(album?.images),
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
    playable: item.is_playable !== false && item.isPlayable !== false,
  };
}
const MAX_RATE_LIMIT_RETRIES = 2;

function retryAfterMilliseconds(response: Response, attempt: number): number {
  const raw = response.headers.get("Retry-After")?.trim();
  const seconds = raw === undefined ? Number.NaN : Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  return 1_000 * (2 ** attempt);
}

async function spotifyJSON(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, any>> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(`${SPOTIFY_API}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      throw new SpotifyLibraryHTTPError(
        response.status,
        "Soggfy does not have an authenticated Spotify session with library access",
      );
    }
    if (response.status === 429) {
      const retryMs = retryAfterMilliseconds(response, attempt);
      if (attempt < MAX_RATE_LIMIT_RETRIES) {
        await Bun.sleep(retryMs);
        continue;
      }
      const retrySeconds = Math.ceil(retryMs / 1_000);
      throw new Error(`Spotify library request was rate limited; retry after ${retrySeconds} seconds`);
    }
    if (!response.ok) {
      throw new Error(`Spotify library request failed with HTTP ${response.status}`);
    }
    const payload = await response.json();
    const mapped = object(payload);
    if (!mapped) throw new Error("Spotify library returned an invalid response");
    return mapped;
  }
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
  if (rawObject?.isLocal === true ||
      (typeof rawObject?.uri === "string" && rawObject.uri.startsWith("spotify:local:"))) {
    return { issue: { index, reason: "unavailable" } };
  }
  const track = normalizeTrack(raw);
  return track ? { track } : { issue: { index, reason: "malformed" } };
}
async function fetchSpotifyLibrarySnapshotFromWebAPI(
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
    let contents: { items: unknown[]; total: number };
    let contentsAvailable = true;
    try {
      contents = await fetchPagedItems(`/playlists/${id}/items`, token, fetchImpl);
    } catch (error) {
      if (!(error instanceof SpotifyLibraryHTTPError) || error.status !== 403) throw error;
      const currentItems = object(playlist?.items);
      const legacyTracks = object(playlist?.tracks);
      const advertisedTotal = Number(currentItems?.total ?? legacyTracks?.total ?? 0);
      contents = {
        items: [],
        total: Number.isFinite(advertisedTotal) && advertisedTotal >= 0 ? advertisedTotal : 0,
      };
      contentsAvailable = false;
    }
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
      contentsAvailable,
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
function normalizeRendererLibraryPayload(payload: SpotifyRendererLibraryPayload): SpotifyLibrarySnapshot {
  const accountID = typeof payload.account?.id === "string" && payload.account.id
    ? payload.account.id : "spotify";
  const displayName = typeof payload.account?.displayName === "string" && payload.account.displayName
    ? payload.account.displayName : accountID;

  const likedTracks: SpotifyLibraryTrack[] = [];
  const likedIssues: SpotifyLibraryIssue[] = [];
  const likedItems = Array.isArray(payload.likedSongs?.items) ? payload.likedSongs.items : [];
  likedItems.forEach((item, index) => {
    const result = classifyWrappedTrack({ item }, index);
    if (result.track) likedTracks.push(result.track);
    if (result.issue) likedIssues.push(result.issue);
  });

  const playlists: SpotifyLibraryPlaylist[] = [];
  for (const raw of Array.isArray(payload.playlists) ? payload.playlists : []) {
    const id = spotifyIDFromURI(raw?.uri, "playlist");
    if (!id) continue;
    const tracks: SpotifyLibraryTrack[] = [];
    const issues: SpotifyLibraryIssue[] = [];
    const items = Array.isArray(raw.items) ? raw.items : [];
    items.forEach((item, index) => {
      const result = classifyWrappedTrack({ item }, index);
      if (result.track) tracks.push(result.track);
      if (result.issue) issues.push(result.issue);
    });
    playlists.push({
      id,
      name: typeof raw.name === "string" && raw.name ? raw.name : "Untitled playlist",
      description: typeof raw.description === "string" ? raw.description : undefined,
      owner: typeof raw.owner === "string" ? raw.owner : undefined,
      imageUrl: firstImage(raw.images),
      snapshotId: typeof raw.snapshotId === "string" ? raw.snapshotId : undefined,
      contentsAvailable: raw.contentsAvailable !== false,
      tracks,
      issues,
      totalCount: Math.max(Number(raw.totalCount) || 0, tracks.length + issues.length),
    });
  }

  return {
    account: { id: accountID, displayName },
    likedSongs: {
      tracks: likedTracks,
      issues: likedIssues,
      totalCount: Math.max(Number(payload.likedSongs?.totalCount) || 0, likedTracks.length + likedIssues.length),
    },
    playlists,
  };
}

export async function fetchSpotifyLibrarySnapshot(
  options: SpotifyLibraryOptions = {},
): Promise<SpotifyLibrarySnapshot> {
  if (options.tokenProvider) return fetchSpotifyLibrarySnapshotFromWebAPI(options);

  const rendererProvider = options.rendererProvider
    ?? (() => fetchSpotifyRendererLibraryPayload({ fetchImpl: options.fetchImpl }));
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return normalizeRendererLibraryPayload(await rendererProvider());
    } catch (error) {
      lastError = error;
      if (attempt < 2) await Bun.sleep(250 * (2 ** attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Spotify renderer library request failed");
}
