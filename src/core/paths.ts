import { homedir } from "os";
import { chmodSync, mkdirSync } from "fs";
import { join } from "path";

const EXPLICIT_SOGGFY_HOME = process.env.SOGGFY_HOME?.trim();
export const SOGGFY_HOME = EXPLICIT_SOGGFY_HOME || join(homedir(), ".soggfy");
export const SOGGFY_RUNTIME_DIR = join(SOGGFY_HOME, "runtime");
export const SOGGFY_DATA = join(SOGGFY_HOME, "data");
export const WORKSPACE_DIR = join(SOGGFY_HOME, "workspace");
export const PATCHED_APP = join(WORKSPACE_DIR, "PatchedSpotify.app");
export const PROFILES_DIR = join(WORKSPACE_DIR, "profiles");
export const OUTPUT_DIR = join(SOGGFY_HOME, "output");
export const RETAINED_CAPTURE_DIR = join(SOGGFY_HOME, "captures");
export const AUTH_DIR = process.env.SOGGFY_AUTH_DIR?.trim() || join(SOGGFY_HOME, "auth");
export const AUTH_STATE_DIR = join(AUTH_DIR, "spotify");
export const PAYLOAD_DIR = join(SOGGFY_HOME, "payload");
export const LOG_DIR = join(SOGGFY_HOME, "logs");
export const PID_FILE = join(SOGGFY_HOME, "daemon.pid");
export const DAEMON_LOG = join(LOG_DIR, "daemon.log");
export const DAEMON_SOCKET = join(SOGGFY_HOME, "daemon.sock");
export const DAEMON_START_LOCK = join(SOGGFY_HOME, "daemon.start.lock");
export const IPC_SOCKET = process.env.SOGGFY_SOCKET_PATH?.trim()
  || (EXPLICIT_SOGGFY_HOME ? join(SOGGFY_RUNTIME_DIR, "spotify.sock") : "/tmp/soggfy_cli.sock");
export const SAVE_PATH = process.env.SOGGFY_SAVE_PATH?.trim()
  || (EXPLICIT_SOGGFY_HOME ? join(SOGGFY_RUNTIME_DIR, "spotify") : "/tmp/Soggfy_cli");
export const AUTH_EXPORT_FILE = "soggfy-auth.json";

export const SPOTIFY_APP = "/Applications/Spotify.app";
export const SPOTIFY_INSTALLER_URL = "https://download.scdn.co/SpotifyInstaller.zip";
export const DOBBY_REPO = "https://github.com/jmpews/Dobby.git";

export const CAPTURE_BACKEND = process.env.SOGGFY_CAPTURE_BACKEND || "ogg";

export function ensureDirs() {
  const dirs = [SOGGFY_HOME, SOGGFY_DATA, SOGGFY_RUNTIME_DIR, WORKSPACE_DIR, PROFILES_DIR, OUTPUT_DIR, RETAINED_CAPTURE_DIR, AUTH_DIR, PAYLOAD_DIR, LOG_DIR];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
}
