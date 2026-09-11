import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { replaceDirectoryAtomically } from "./atomic-directory";
import { AUTH_DIR, AUTH_STATE_DIR } from "./paths";
import { cloneSpotifyLoginState, cloneSpotifyWebKitState } from "./spotify-runtime";
import { acquireAuthStateLock, AUTH_STATE_LOCK } from "./auth-lock";

export type AuthMigrationResult = "existing" | "migrated" | "upgraded" | "suppressed" | "unavailable";

export interface AuthMigrationPaths {
  authDir: string;
  authStateDir: string;
  officialSupportDir: string;
  officialWebKitDir: string;
  markerPath: string;
  lockPath?: string;
}

export const AUTH_MIGRATION_MARKER = join(AUTH_DIR, ".official-import-v1");

function defaultPaths(): AuthMigrationPaths {
  return {
    authDir: AUTH_DIR,
    authStateDir: AUTH_STATE_DIR,
    officialSupportDir: join(homedir(), "Library/Application Support/Spotify"),
    officialWebKitDir: join(homedir(), "Library/WebKit/com.spotify.client"),
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

function loginIdentity(root: string): string | null {
  const prefsPath = join(root, "prefs");
  if (!existsSync(prefsPath)) return null;
  const prefs = readFileSync(prefsPath, "utf8");
  return prefs.match(/autologin\.(?:username|canonical_username)="([^"]+)"/)?.[1] ?? null;
}

function upgradeExistingWebKitState(paths: AuthMigrationPaths): boolean {
  const destination = join(paths.authStateDir, "WebKit/com.spotify.client");
  if (existsSync(destination)) return false;
  const ownedIdentity = loginIdentity(paths.authStateDir);
  const officialIdentity = loginIdentity(paths.officialSupportDir);
  if (!ownedIdentity || ownedIdentity !== officialIdentity) return false;

  const stage = `${destination}.upgrade-${process.pid}-${Date.now()}`;
  rmSync(stage, { recursive: true, force: true });
  try {
    if (!cloneSpotifyWebKitState(paths.officialWebKitDir, stage)) return false;
    replaceDirectoryAtomically(stage, destination);
    return true;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function markOfficialSpotifyAuthMigrationComplete(markerPath = AUTH_MIGRATION_MARKER): void {
  mkdirSync(dirname(markerPath), { recursive: true, mode: 0o700 });
  writeFileSync(markerPath, "completed\n", { mode: 0o600 });
  chmodSync(markerPath, 0o600);
}

export function migrateOfficialSpotifyAuthOnce(
  paths?: AuthMigrationPaths,
): AuthMigrationResult {
  // Custom/test homes must opt in through auth login/import, never inherit the
  // machine's official account just because a capture instance starts. An
  // explicit path equal to the normal ~/.soggfy default (for example from
  // Bun-loaded .env) is not a custom home and may use the normal migration.
  const explicitHome = process.env.SOGGFY_HOME?.trim();
  const defaultHome = join(homedir(), ".soggfy");
  if (!paths && explicitHome && resolve(explicitHome) !== resolve(defaultHome)) {
    return existsSync(AUTH_STATE_DIR) ? "existing" : "suppressed";
  }
  paths ??= defaultPaths();
  const lock = acquireAuthStateLock(paths.lockPath ?? join(paths.authDir, ".state.lock"));
  try {
    if (existsSync(paths.authStateDir)) {
      return upgradeExistingWebKitState(paths) ? "upgraded" : "existing";
    }
    if (existsSync(paths.markerPath)) return "suppressed";
    if (!hasReusableOfficialLoginState(paths.officialSupportDir)) return "unavailable";

    mkdirSync(paths.authDir, { recursive: true, mode: 0o700 });
    const stage = `${paths.authStateDir}.migration-${process.pid}-${Date.now()}`;
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true, mode: 0o700 });
    try {
      const copied = cloneSpotifyLoginState(stage, paths.officialSupportDir, {
        webKitSourceDir: paths.officialWebKitDir,
        webKitDest: join(stage, "WebKit/com.spotify.client"),
      });
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
