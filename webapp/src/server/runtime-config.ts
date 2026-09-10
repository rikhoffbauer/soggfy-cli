import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { LOG_DIR, PROFILES_DIR, SAVE_PATH, SOGGFY_HOME } from "../../../src/core/paths";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const WEBAPP_DIR = join(SERVER_DIR, "..");
export const REPO_ROOT = join(WEBAPP_DIR, "..");
export const USE_DAEMON_INSTANCE = process.env.SOGGFY_USE_DAEMON_INSTANCE === "1";
export const POOL_SIZE = USE_DAEMON_INSTANCE ? 1 : Number.parseInt(process.env.SOGGFY_POOL_SIZE || "1", 10);
export const SOGGFY_HIDDEN = process.env.SOGGFY_HIDDEN !== "0";
export const MAX_ATTEMPTS = Number.parseInt(process.env.SOGGFY_MAX_ATTEMPTS || "3", 10);
export const BASE_DEBUG_PORT = Number.parseInt(process.env.SOGGFY_DEBUG_PORT_BASE || "9223", 10);
export const MUTE_OUTPUT = process.env.SOGGFY_MUTE_OUTPUT || "1";
export const RUNTIME_DIR = join(SOGGFY_HOME, "runtime");
export const LOG_ROOTS = { logDir: LOG_DIR, runtimeDir: RUNTIME_DIR, profilesDir: PROFILES_DIR, payloadDir: SAVE_PATH };
