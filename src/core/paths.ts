import { homedir } from "os";
import { chmodSync, mkdirSync } from "fs";
import { join } from "path";

export const SOGGFY_HOME = join(homedir(), ".soggfy");
export const SOGGFY_DATA = join(SOGGFY_HOME, "data");
export const WORKSPACE_DIR = join(SOGGFY_HOME, "workspace");
export const PATCHED_APP = join(WORKSPACE_DIR, "PatchedSpotify.app");
export const PROFILES_DIR = join(WORKSPACE_DIR, "profiles");
export const OUTPUT_DIR = join(SOGGFY_HOME, "output");
export const AUTH_DIR = join(SOGGFY_HOME, "auth");
export const PAYLOAD_DIR = join(SOGGFY_HOME, "payload");
export const LOG_DIR = join(SOGGFY_HOME, "logs");
export const PID_FILE = join(SOGGFY_HOME, "daemon.pid");
export const DAEMON_LOG = join(LOG_DIR, "daemon.log");
export const DAEMON_SOCKET = join(SOGGFY_HOME, "daemon.sock");
export const IPC_SOCKET = "/tmp/soggfy_cli.sock";
export const SAVE_PATH = "/tmp/Soggfy_cli";
export const AUTH_EXPORT_FILE = "soggfy-auth.json";

export const SPOTIFY_APP = "/Applications/Spotify.app";
export const SPOTIFY_INSTALLER_URL = "https://download.scdn.co/SpotifyInstaller.zip";
export const DOBBY_REPO = "https://github.com/jmpews/Dobby.git";

export const CAPTURE_BACKEND = process.env.SOGGFY_CAPTURE_BACKEND || "pcm";

export function ensureDirs() {
  const dirs = [SOGGFY_HOME, SOGGFY_DATA, WORKSPACE_DIR, PROFILES_DIR, OUTPUT_DIR, AUTH_DIR, PAYLOAD_DIR, LOG_DIR];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
}
