import type { SpotifyInstance } from "./instance";

const DAEMON_INSTANCE_KEY = Symbol.for("soggfy.daemonSpotifyInstance");
type GlobalWithDaemonInstance = typeof globalThis & {
  [DAEMON_INSTANCE_KEY]?: SpotifyInstance;
};

function state(): GlobalWithDaemonInstance {
  return globalThis as GlobalWithDaemonInstance;
}

export function registerDaemonSpotifyInstance(instance: SpotifyInstance): void {
  state()[DAEMON_INSTANCE_KEY] = instance;
}

export function unregisterDaemonSpotifyInstance(instance: SpotifyInstance): void {
  if (state()[DAEMON_INSTANCE_KEY] === instance) delete state()[DAEMON_INSTANCE_KEY];
}

export function getDaemonSpotifyInstance(): SpotifyInstance {
  const instance = state()[DAEMON_INSTANCE_KEY];
  if (!instance) {
    throw new Error("Daemon Spotify instance is not registered in this process");
  }
  return instance;
}
