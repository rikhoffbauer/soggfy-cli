import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getFingerprint } from "./fingerprint";

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  durationMs?: number;
  isPlayable?: boolean;
  playabilityReason?: string;
  audioPreviewUrl?: string;
}

export async function fetchTrackMetadata(trackId: string): Promise<TrackMetadata> {
  const meta: TrackMetadata = {};
  try {
    const res = await fetch(`https://open.spotify.com/embed/track/${trackId}`);
    if (!res.ok) return meta;
    const html = await res.text();

    // Parse duration
    const durationMatch = html.match(/"duration"\s*:\s*(\d+)/);
    if (durationMatch?.[1]) meta.durationMs = parseInt(durationMatch[1], 10);

    // Parse __NEXT_DATA__ for structured metadata
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">({.*?})<\/script>/,
    );
    if (nextDataMatch?.[1]) {
      const data = JSON.parse(nextDataMatch[1]);
      const entity = data.props?.pageProps?.state?.data?.entity;
      if (entity) {
        meta.title = entity.title || entity.name;
        meta.artist = entity.artists?.[0]?.name;
        meta.album = entity.albumOfTrack?.name;
        meta.coverUrl = entity.visualIdentity?.image?.[0]?.url;
        if (typeof entity.isPlayable === "boolean") meta.isPlayable = entity.isPlayable;
        if (typeof entity.playabilityReason === "string") meta.playabilityReason = entity.playabilityReason;
        if (typeof entity.audioPreview?.url === "string") meta.audioPreviewUrl = entity.audioPreview.url;
      }
    }
  } catch {
    // Metadata is best-effort; failure is non-fatal
  }
  return meta;
}


function normalizeMatchText(value: string | undefined): string {
  return (value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function parseRawFingerprint(value: string): number[] {
  return value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter(Number.isFinite)
    .map((value) => value >>> 0);
}

function bitCount32(value: number): number {
  value = value - ((value >>> 1) & 0x55555555);
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function rawFingerprintSimilarity(left: string, right: string): number | null {
  const a = parseRawFingerprint(left);
  const b = parseRawFingerprint(right);
  const overlap = Math.min(a.length, b.length);
  if (overlap < 40) return null;

  let differentBits = 0;
  for (let i = 0; i < overlap; i++) differentBits += bitCount32((a[i] ?? 0) ^ (b[i] ?? 0));
  return 1 - differentBits / (32 * overlap);
}

async function fetchPreviewFingerprint(url: string): Promise<string | null> {
  if (!Bun.which("fpcalc")) return null;
  const dir = mkdtempSync(join(tmpdir(), "soggfy-preview-"));
  const path = join(dir, "preview.mp3");
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    await Bun.write(path, await response.arrayBuffer());
    return getFingerprint(path, 30)?.fingerprint ?? null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function compareSpotifyPreviews(leftUrl: string, rightUrl: string): Promise<number | null> {
  const [left, right] = await Promise.all([
    fetchPreviewFingerprint(leftUrl),
    fetchPreviewFingerprint(rightUrl),
  ]);
  if (!left || !right) return null;
  return rawFingerprintSimilarity(left, right);
}

function titleLooksRelated(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right} -`) || right.startsWith(`${left} -`) ||
    left.startsWith(`${right} (`) || right.startsWith(`${left} (`);
}

export interface PlayableTrackResolution {
  requestedTrackId: string;
  trackId: string;
  relinked: boolean;
  metadata: TrackMetadata;
}

export async function resolvePlayableTrackId(
  trackId: string,
  options: { previewSimilarity?: (leftUrl: string, rightUrl: string) => Promise<number | null> } = {},
): Promise<PlayableTrackResolution> {
  const metadata = await fetchTrackMetadata(trackId);
  if (metadata.isPlayable !== false) {
    return { requestedTrackId: trackId, trackId, relinked: false, metadata };
  }

  if (!metadata.title || !metadata.artist) {
    throw new Error(`Spotify track ${trackId} is unavailable and its metadata is insufficient to find a playable equivalent`);
  }

  const { searchSpotify, invalidateSpotifySearchTokens } = await import("./spotify-search");
  let results = null;
  let lastSearchError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      results = await searchSpotify(`${metadata.title} ${metadata.artist}`, {
        types: ["track"],
        limit: 10,
      });
      break;
    } catch (error) {
      lastSearchError = error;
      invalidateSpotifySearchTokens();
    }
  }
  if (!results) {
    const detail = lastSearchError instanceof Error ? lastSearchError.message : String(lastSearchError);
    throw new Error(`Spotify track ${trackId} is unavailable and equivalent-track lookup failed: ${detail}`);
  }

  const wantedTitle = normalizeMatchText(metadata.title);
  const wantedArtist = normalizeMatchText(metadata.artist);
  const artistMatches = (subtitle: string) =>
    normalizeMatchText(subtitle).split(",").map((part) => part.trim()).includes(wantedArtist);
  const metadataCache = new Map<string, TrackMetadata>();
  const candidateMetadata = async (id: string) => {
    const cached = metadataCache.get(id);
    if (cached) return cached;
    const value = await fetchTrackMetadata(id);
    metadataCache.set(id, value);
    return value;
  };

  const exactCandidates = results.filter((result) =>
    result.type === "track" &&
    result.id !== trackId &&
    normalizeMatchText(result.name) === wantedTitle &&
    artistMatches(result.subtitle)
  );

  for (const candidate of exactCandidates) {
    const candidateMeta = await candidateMetadata(candidate.id);
    if (candidateMeta.isPlayable === true) {
      return {
        requestedTrackId: trackId,
        trackId: candidate.id,
        relinked: true,
        metadata: candidateMeta,
      };
    }
  }

  if (metadata.audioPreviewUrl) {
    const previewSimilarity = options.previewSimilarity ?? compareSpotifyPreviews;
    const previewCandidates = results.filter((result) => {
      if (result.type !== "track" || result.id === trackId || !artistMatches(result.subtitle)) return false;
      return titleLooksRelated(normalizeMatchText(result.name), wantedTitle);
    });

    for (const candidate of previewCandidates) {
      const candidateMeta = await candidateMetadata(candidate.id);
      if (candidateMeta.isPlayable !== true || !candidateMeta.audioPreviewUrl) continue;
      const similarity = await previewSimilarity(metadata.audioPreviewUrl, candidateMeta.audioPreviewUrl);
      if (similarity !== null && similarity >= 0.9) {
        return {
          requestedTrackId: trackId,
          trackId: candidate.id,
          relinked: true,
          metadata: candidateMeta,
        };
      }
    }
  }

  throw new Error(`Spotify track ${trackId} is unavailable and no verified playable equivalent was found`);
}

/**
 * Resolve a spotify URL/URI to a list of track IDs.
 * Supports single tracks, playlists, and albums.
 */
export async function resolveInput(input: string): Promise<string[]> {
  // Import inline to avoid circular dep
  const { parseTrackId, parsePlaylistId, parseAlbumId, extractTrackIds } = await import("./spotify-url");

  const trackId = parseTrackId(input);
  if (trackId) {
    const resolved = await resolvePlayableTrackId(trackId);
    return [resolved.trackId];
  }

  const playlistId = parsePlaylistId(input);
  if (playlistId) {
    try {
      const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`);
      return extractTrackIds(await res.text());
    } catch {
      return [];
    }
  }

  const albumId = parseAlbumId(input);
  if (albumId) {
    try {
      const res = await fetch(`https://open.spotify.com/embed/album/${albumId}`);
      return extractTrackIds(await res.text());
    } catch {
      return [];
    }
  }

  return [];
}
