import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { log } from "../core/log";
import { AUTH_STATE_DIR, SPOTIFY_APP, ensureDirs } from "../core/paths";
import { exportAuthSnapshot, importAuthSnapshot, importLegacyAuthSnapshot, type AuthSnapshotV2 } from "../core/auth-state";
import { replaceDirectoryAtomically } from "../core/atomic-directory";
import { cloneSpotifyLoginState, terminateProcessTree } from "../core/spotify-runtime";
import { markOfficialSpotifyAuthMigrationComplete } from "../core/auth-migration";
import { acquireAuthStateLock } from "../core/auth-lock";

const OFFICIAL_SPOTIFY_SUPPORT = join(homedir(), "Library/Application Support/Spotify");
const OFFICIAL_SPOTIFY_WEBKIT = join(homedir(), "Library/WebKit/com.spotify.client");
const PREFS_FILE = join(AUTH_STATE_DIR, "prefs");

function readPrefs(): string | null {
  if (!existsSync(PREFS_FILE)) return null;
  return readFileSync(PREFS_FILE, "utf8");
}

function parseUsername(prefs: string | null): string | null {
  if (!prefs) return null;
  return prefs.match(/autologin\.username="([^"]+)"/)?.[1]
    ?? prefs.match(/autologin\.canonical_username="([^"]+)"/)?.[1]
    ?? null;
}

function captureOfficialLoginState(): void {
  const lock = acquireAuthStateLock();
  const stage = `${AUTH_STATE_DIR}.login-${process.pid}-${Date.now()}`;
  try {
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true, mode: 0o700 });
    const copied = cloneSpotifyLoginState(stage, OFFICIAL_SPOTIFY_SUPPORT, {
      webKitSourceDir: OFFICIAL_SPOTIFY_WEBKIT,
      webKitDest: join(stage, "WebKit/com.spotify.client"),
    });
    if (!copied.copiedPrefs && !copied.copiedUsers && !copied.copiedSessionCache) {
      throw new Error("Spotify did not expose reusable login state after authentication");
    }
    replaceDirectoryAtomically(stage, AUTH_STATE_DIR);
    markOfficialSpotifyAuthMigrationComplete();
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  } finally {
    lock.release();
  }
}

export async function authCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") {
    console.error(`\nUsage: soggfy auth <login|logout|status|export|import>\n`);
    return;
  }
  switch (sub) {
    case "login": return authLogin();
    case "logout": return authLogout();
    case "status": return authStatus();
    case "export": return authExport(args[1]);
    case "import": return authImport(args[1]);
    default: throw new Error(`Unknown auth subcommand: ${sub}`);
  }
}

async function authLogin(): Promise<void> {
  if (!existsSync(SPOTIFY_APP)) throw new Error("Spotify.app not found in /Applications. Run 'soggfy install' first.");
  ensureDirs();
  log.header("Spotify Login");
  log.info("Opening official Spotify for interactive login...");
  log.info("Log in, wait for the main UI, then return here and press Enter.");
  const spotifyBinary = join(SPOTIFY_APP, "Contents/MacOS/Spotify");
  const spotify = Bun.spawn([spotifyBinary], { stdout: "ignore", stderr: "ignore" });
  process.stderr.write("Press Enter after Spotify is logged in and loaded... ");
  for await (const _line of console) break;
  await terminateProcessTree(spotify.pid, spotify.exited);
  captureOfficialLoginState();
  const username = parseUsername(readPrefs());
  if (username) log.ok(`Soggfy login state captured for: ${username}`);
  else log.ok("Soggfy login state captured.");
}

function authLogout(): void {
  log.header("Spotify Logout");
  const lock = acquireAuthStateLock();
  try {
    markOfficialSpotifyAuthMigrationComplete();
    if (!existsSync(AUTH_STATE_DIR)) {
      log.info("No Soggfy credentials found.");
      return;
    }
    rmSync(AUTH_STATE_DIR, { recursive: true, force: true });
    log.ok("Soggfy credentials removed. Official Spotify login was left untouched.");
  } finally {
    lock.release();
  }
}

function authStatus(): void {
  log.header("Auth Status");
  const username = parseUsername(readPrefs());
  if (existsSync(AUTH_STATE_DIR)) {
    if (username) log.ok(`Soggfy login state: ${username}`);
    else log.ok("Soggfy login state is present.");
    log.dim(`  State: ${AUTH_STATE_DIR}`);
  } else {
    log.warn("No Soggfy login state.");
    log.info("Run 'soggfy auth login' to authenticate.");
  }
}

function authExport(outputPath?: string): void {
  const lock = acquireAuthStateLock();
  try {
    if (!existsSync(AUTH_STATE_DIR)) throw new Error("No credentials to export. Run 'soggfy auth login' first.");
    const snapshot = exportAuthSnapshot(AUTH_STATE_DIR);
    if (!Object.keys(snapshot.files).length) throw new Error("Soggfy auth state is empty");
    const outFile = outputPath ? resolve(outputPath) : resolve("soggfy-auth.json");
    writeFileSync(outFile, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    chmodSync(outFile, 0o600);
    log.ok(`Credentials exported to: ${outFile}`);
  } finally {
    lock.release();
  }
}

function authImport(inputPath?: string): void {
  if (!inputPath) throw new Error("Usage: soggfy auth import <file>");
  const path = resolve(inputPath);
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  let snapshot: AuthSnapshotV2 | any;
  try { snapshot = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`Failed to parse auth file: ${error instanceof Error ? error.message : error}`); }
  ensureDirs();
  const lock = acquireAuthStateLock();
  try {
    if (snapshot.version === 2) importAuthSnapshot(AUTH_STATE_DIR, snapshot);
    else if (snapshot.version === 1) importLegacyAuthSnapshot(AUTH_STATE_DIR, snapshot);
    else throw new Error(`Unsupported auth snapshot version: ${snapshot.version}`);
    markOfficialSpotifyAuthMigrationComplete();
    log.ok(`Credentials imported into Soggfy-owned state: ${AUTH_STATE_DIR}`);
  } finally {
    lock.release();
  }
}
