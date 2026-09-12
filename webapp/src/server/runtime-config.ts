import { dirname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { LOG_DIR, PROFILES_DIR, SAVE_PATH, SOGGFY_HOME } from "../../../src/core/paths";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
export function resolveRepoRoot(serverDir = SERVER_DIR): string {
  const sourceMarker = `${sep}webapp${sep}src${sep}server`;
  const bundledMarker = `${sep}dist${sep}webapp`;
  if (serverDir.includes(sourceMarker)) return resolve(serverDir, "../../..");
  if (serverDir.includes(bundledMarker)) return resolve(serverDir, "../..");
  return resolve(serverDir, "../../..");
}
export const REPO_ROOT = resolveRepoRoot();

export function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const USE_DAEMON_INSTANCE = process.env.SOGGFY_USE_DAEMON_INSTANCE === "1";
export const POOL_SIZE = USE_DAEMON_INSTANCE ? 1 : Math.max(1, intFromEnv(process.env.SOGGFY_POOL_SIZE, 1));
export const SOGGFY_HIDDEN = process.env.SOGGFY_HIDDEN !== "0";
export const MAX_ATTEMPTS = Math.max(1, intFromEnv(process.env.SOGGFY_MAX_ATTEMPTS, 3));
export const BASE_DEBUG_PORT = intFromEnv(process.env.SOGGFY_DEBUG_PORT_BASE, 9223);
export const MUTE_OUTPUT = process.env.SOGGFY_MUTE_OUTPUT || "1";
export const RUNTIME_DIR = join(SOGGFY_HOME, "runtime");
export const LOG_ROOTS = { logDir: LOG_DIR, runtimeDir: RUNTIME_DIR, profilesDir: PROFILES_DIR, payloadDir: SAVE_PATH };
