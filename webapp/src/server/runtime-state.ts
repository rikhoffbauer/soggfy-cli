import { OUTPUT_DIR } from "../../../src/core/paths";
import type { SpotifyPlaylistTrack } from "../../../src/core/spotify-playlist";
import { JobRegistry, type TrackMetadata } from "./jobs";
import { intFromEnv } from "./runtime-config";

export const jobs = new JobRegistry({
  maxTerminalJobs: intFromEnv(process.env.SOGGFY_HISTORY_LIMIT, 250),
});
let persistedJobsRestored = false;

export function restorePersistedJobs(): number {
  if (persistedJobsRestored) return 0;
  persistedJobsRestored = true;
  return jobs.hydrateFromOutputDir(OUTPUT_DIR);
}

export const GLOBAL_METADATA: Record<string, TrackMetadata> = {};

export function cachePlaylistTrackMetadata(track: SpotifyPlaylistTrack): void {
  GLOBAL_METADATA[track.id] = {
    title: track.name,
    artist: track.artists.join(", ") || "Unknown artist",
    coverUrl: track.imageUrl,
  };
}
