import type { SpotifyInstance } from "./instance";

let daemonSpotifyInstance: SpotifyInstance | null = null;

export function registerDaemonSpotifyInstance(instance: SpotifyInstance): void {
  daemonSpotifyInstance = instance;
}

export function unregisterDaemonSpotifyInstance(instance: SpotifyInstance): void {
  if (daemonSpotifyInstance === instance) daemonSpotifyInstance = null;
}

export function getDaemonSpotifyInstance(): SpotifyInstance {
  if (!daemonSpotifyInstance) {
    throw new Error("Daemon Spotify instance is not registered in this process");
  }
  return daemonSpotifyInstance;
}
