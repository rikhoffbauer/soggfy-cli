export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  durationMs?: number;
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
      }
    }
  } catch {
    // Metadata is best-effort; failure is non-fatal
  }
  return meta;
}

/**
 * Resolve a spotify URL/URI to a list of track IDs.
 * Supports single tracks, playlists, and albums.
 */
export async function resolveInput(input: string): Promise<string[]> {
  // Import inline to avoid circular dep
  const { parseTrackId, parsePlaylistId, parseAlbumId, extractTrackIds } = await import("./spotify-url");

  const trackId = parseTrackId(input);
  if (trackId) return [trackId];

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
