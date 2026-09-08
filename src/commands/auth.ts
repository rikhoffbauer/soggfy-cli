import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join, resolve, sep } from "path";
import { homedir } from "os";
import { log } from "../core/log";
import { AUTH_DIR, SPOTIFY_APP } from "../core/paths";
import { terminateProcessTree } from "../core/spotify-runtime";

const SPOTIFY_SUPPORT = join(homedir(), "Library/Application Support/Spotify");
const PREFS_FILE = join(SPOTIFY_SUPPORT, "prefs");
const USERS_DIR = join(SPOTIFY_SUPPORT, "Users");

interface AuthSnapshot {
  version: 1;
  exportedAt: string;
  prefs: string | null;
  users: Record<string, string> | null;
}

function readPrefs(): string | null {
  if (!existsSync(PREFS_FILE)) return null;
  return readFileSync(PREFS_FILE, "utf-8");
}

function parseUsername(prefs: string | null): string | null {
  if (!prefs) return null;
  // Spotify prefs file has lines like: autologin.username="user123"
  const match = prefs.match(/autologin\.username="([^"]+)"/);
  if (match?.[1]) return match[1];
  // Also check for facebook-linked accounts
  const canonical = prefs.match(/autologin\.canonical_username="([^"]+)"/);
  return canonical?.[1] ?? null;
}

function readUsersDir(): Record<string, string> | null {
  if (!existsSync(USERS_DIR)) return null;
  const result: Record<string, string> = {};
  try {
    // Walk the Users directory and capture key files
    const entries = readdirSync(USERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const userDir = join(USERS_DIR, entry.name);
        const subEntries = readdirSync(userDir, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isFile()) {
            const filePath = join(userDir, sub.name);
            const relPath = `${entry.name}/${sub.name}`;
            try {
              result[relPath] = readFileSync(filePath).toString("base64");
            } catch {}
          }
        }
      }
    }
  } catch {}
  return Object.keys(result).length > 0 ? result : null;
}

function restoreUsersDir(users: Record<string, string>): void {
  mkdirSync(USERS_DIR, { recursive: true, mode: 0o700 });
  const usersRoot = `${resolve(USERS_DIR)}${sep}`;
  for (const [relPath, base64Content] of Object.entries(users)) {
    if (typeof base64Content !== "string") throw new Error(`Invalid auth entry: ${relPath}`);
    const fullPath = resolve(USERS_DIR, relPath);
    if (!fullPath.startsWith(usersRoot)) {
      throw new Error(`Refusing auth path outside Spotify Users: ${relPath}`);
    }
    mkdirSync(join(fullPath, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(fullPath, Buffer.from(base64Content, "base64"), { mode: 0o600 });
    chmodSync(fullPath, 0o600);
  }
}

export async function authCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    console.error(`
Usage: soggfy auth <subcommand>

Subcommands:
  login     Open Spotify for interactive login
  logout    Remove stored credentials
  status    Show current authentication status
  export    Export credentials to a portable file
  import    Import credentials from a file
`);
    return;
  }

  switch (sub) {
    case "login":
      return authLogin();
    case "logout":
      return authLogout();
    case "status":
      return authStatus();
    case "export":
      return authExport(args[1]);
    case "import":
      return authImport(args[1]);
    default:
      log.error(`Unknown auth subcommand: ${sub}`);
      process.exit(1);
  }
}

async function authLogin(): Promise<void> {
  if (!existsSync(SPOTIFY_APP)) {
    log.error("Spotify.app not found in /Applications. Run 'soggfy install' first.");
    process.exit(1);
  }

  log.header("Spotify Login");
  log.info("Opening Spotify for interactive login...");
  log.info("Log in to your Spotify account, wait for the main UI to load,");
  log.info("then return here and press Enter.");
  console.error();

  // Launch the official Spotify binary directly so cleanup can target only this process tree.
  const spotifyBinary = join(SPOTIFY_APP, "Contents/MacOS/Spotify");
  const spotify = Bun.spawn([spotifyBinary], { stdout: "ignore", stderr: "ignore" });

  // Wait for user to press Enter
  process.stderr.write("Press Enter after Spotify is logged in and loaded... ");
  for await (const line of console) {
    break; // consume one line
  }

  // Stop only the Spotify process tree launched by this command.
  await terminateProcessTree(spotify.pid, spotify.exited);

  // Verify login state
  const prefs = readPrefs();
  const username = parseUsername(prefs);
  if (username) {
    log.ok(`Logged in as: ${username}`);
  } else {
    log.warn("Could not verify login. Prefs file may not have been written yet.");
    log.info("Try opening Spotify manually, logging in, and running 'soggfy auth status'.");
  }
}

function authLogout(): void {
  log.header("Spotify Logout");

  let removed = false;
  if (existsSync(PREFS_FILE)) {
    rmSync(PREFS_FILE);
    removed = true;
  }
  if (existsSync(USERS_DIR)) {
    rmSync(USERS_DIR, { recursive: true });
    removed = true;
  }

  if (removed) {
    log.ok("Credentials removed.");
  } else {
    log.info("No credentials found.");
  }
}

function authStatus(): void {
  log.header("Auth Status");

  const prefs = readPrefs();
  const username = parseUsername(prefs);

  if (username) {
    log.ok(`Logged in as: ${username}`);
    log.dim(`  Prefs: ${PREFS_FILE}`);
    if (existsSync(USERS_DIR)) {
      log.dim(`  Users dir: ${USERS_DIR}`);
    }
  } else {
    log.warn("Not logged in.");
    log.info("Run 'soggfy auth login' to authenticate.");
  }
}

function authExport(outputPath?: string): void {
  log.header("Export Credentials");

  const prefs = readPrefs();
  const users = readUsersDir();

  if (!prefs && !users) {
    log.error("No credentials to export. Run 'soggfy auth login' first.");
    process.exit(1);
  }

  const snapshot: AuthSnapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    prefs,
    users,
  };

  const outFile = outputPath ? resolve(outputPath) : resolve("soggfy-auth.json");
  writeFileSync(outFile, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  chmodSync(outFile, 0o600);
  log.ok(`Credentials exported to: ${outFile}`);

  const username = parseUsername(prefs);
  if (username) log.dim(`  Account: ${username}`);
}

function authImport(inputPath?: string): void {
  log.header("Import Credentials");

  if (!inputPath) {
    log.error("Usage: soggfy auth import <file>");
    process.exit(1);
  }

  const resolvedPath = resolve(inputPath);
  if (!existsSync(resolvedPath)) {
    log.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  let snapshot: AuthSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(resolvedPath, "utf-8"));
  } catch (e: any) {
    log.error(`Failed to parse auth file: ${e.message}`);
    process.exit(1);
  }

  if (snapshot.version !== 1) {
    log.error(`Unsupported auth snapshot version: ${snapshot.version}`);
    process.exit(1);
  }

  mkdirSync(SPOTIFY_SUPPORT, { recursive: true });

  if (snapshot.prefs) {
    writeFileSync(PREFS_FILE, snapshot.prefs, { mode: 0o600 });
    chmodSync(PREFS_FILE, 0o600);
    log.ok("Prefs restored.");
  }

  if (snapshot.users) {
    restoreUsersDir(snapshot.users);
    log.ok("Users directory restored.");
  }

  const username = parseUsername(snapshot.prefs);
  if (username) log.ok(`Imported credentials for: ${username}`);
  else log.ok("Credentials imported.");
}
