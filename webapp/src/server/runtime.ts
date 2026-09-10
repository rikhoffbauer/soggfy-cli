import { mkdirSync } from "fs";
import { resolveInput as resolveSpotifyInput } from "../../../src/core/metadata";
import { OUTPUT_DIR, PROFILES_DIR } from "../../../src/core/paths";
import { SpotifyPoolManager } from "./pool";
import { POOL_SIZE, RUNTIME_DIR } from "./runtime-config";

export { GLOBAL_METADATA, cachePlaylistTrackMetadata, jobs } from "./runtime-state";
import { restorePersistedJobs } from "./runtime-state";
export { LOG_ROOTS, POOL_SIZE, REPO_ROOT, USE_DAEMON_INSTANCE } from "./runtime-config";
export { fetchTrackDuration, fetchTrackMetadata } from "./spotify-metadata";
export { findOutputForTrack } from "./outputs";

export function initializeRuntimeState(): number {
  for (const dir of [OUTPUT_DIR, RUNTIME_DIR, PROFILES_DIR]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return restorePersistedJobs();
}

export const pool = new SpotifyPoolManager(POOL_SIZE);

export async function resolveSpotifyUrl(input: string): Promise<string[]> {
  return resolveSpotifyInput(input);
}
