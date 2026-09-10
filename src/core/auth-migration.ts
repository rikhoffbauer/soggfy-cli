import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { replaceDirectoryAtomically } from "./atomic-directory";
import { AUTH_DIR, AUTH_STATE_DIR } from "./paths";
import { cloneSpotifyLoginState } from "./spotify-runtime";
import { acquireAuthStateLock, AUTH_STATE_LOCK } from "./auth-lock";

export type AuthMigrationResult = "existing" | "migrated" | "suppressed" | "unavailable";

export interface AuthMigrationPaths {
  authDir: string;
  authStateDir: string;
  officialSupportDir: string;
  markerPath: string;
  lockPath?: string;
}

export const AUTH_MIGRATION_MARKER = join(AUTH_DIR, ".official-import-v1");

function defaultPaths(): AuthMigrationPaths {
  return {
    authDir: AUTH_DIR,
    authStateDir: AUTH_STATE_DIR,
    officialSupportDir: join(homedir(), "Library/Application Support/Spotify"),
    markerPath: AUTH_MIGRATION_MARKER,
    lockPath: AUTH_STATE_LOCK,
  };
}

function hasReusableOfficialLoginState(root: string): boolean {
  const prefsPath = join(root, "prefs");
  if (!existsSync(prefsPath)) return false;
  const prefs = readFileSync(prefsPath, "utf8");
  const hasIdentity = /autologin\.(?:username|canonical_username)="[^"]+"/.test(prefs);
  if (!hasIdentity) return false;
  return existsSync(join(root, "Users")) || existsSync(join(root, "PersistentCache/Users"));
}

export function markOfficialSpotifyAuthMigrationComplete(markerPath = AUTH_MIGRATION_MARKER): void {
  mkdirSync(join(markerPath, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(markerPath, "completed\n", { mode: 0o600 });
  chmodSync(markerPath, 0o600);
}

export function migrateOfficialSpotifyAuthOnce(
  paths?: AuthMigrationPaths,
): AuthMigrationResult {
  // Custom/test homes must opt in through auth login/import, never inherit the
  // machine's official account just because a capture instance starts.
  if (!paths && process.env.SOGGFY_HOME?.trim()) {
    return existsSync(AUTH_STATE_DIR) ? "existing" : "suppressed";
  }
  paths ??= defaultPaths();
  const lock = acquireAuthStateLock(paths.lockPath ?? join(paths.authDir, ".state.lock"));
  try {
    if (existsSync(paths.authStateDir)) return "existing";
    if (existsSync(paths.markerPath)) return "suppressed";
    if (!hasReusableOfficialLoginState(paths.officialSupportDir)) return "unavailable";

    mkdirSync(paths.authDir, { recursive: true, mode: 0o700 });
    const stage = `${paths.authStateDir}.migration-${process.pid}-${Date.now()}`;
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true, mode: 0o700 });
    try {
      const copied = cloneSpotifyLoginState(stage, paths.officialSupportDir);
      if (!copied.copiedPrefs || (!copied.copiedUsers && !copied.copiedSessionCache)) {
        rmSync(stage, { recursive: true, force: true });
        return "unavailable";
      }
      replaceDirectoryAtomically(stage, paths.authStateDir);
      markOfficialSpotifyAuthMigrationComplete(paths.markerPath);
      return "migrated";
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  } finally {
    lock.release();
  }
}
