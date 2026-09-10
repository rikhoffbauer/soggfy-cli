import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "fs";
import { join } from "path";
import { isSpotifyVersionSupported, latestSupportedSpotifyVersion, supportedSpotifyVersions } from "./spotify-compatibility";
import { AUTH_STATE_DIR } from "./paths";
import { acquireAuthStateLock } from "./auth-lock";

export interface LoginStateCloneResult {
  copiedPrefs: boolean;
  copiedUsers: boolean;
  copiedSessionCache: boolean;
}

export const SUPPORTED_SPOTIFY_VERSION = latestSupportedSpotifyVersion() ?? "0.0.0";

export function readSpotifyBundleVersion(appPath: string): string | null {
  const infoPlist = join(appPath, "Contents/Info.plist");
  if (!existsSync(infoPlist)) return null;
  const result = Bun.spawnSync([
    "/usr/libexec/PlistBuddy",
    "-c",
    "Print :CFBundleShortVersionString",
    infoPlist,
  ], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim() || null;
}

export function assertSupportedSpotifyBundle(appPath: string): void {
  const version = readSpotifyBundleVersion(appPath);
  if (!version || !isSpotifyVersionSupported(version)) {
    throw new Error(
      `Unsupported Spotify build ${version ?? "unknown"}; capture hooks are validated for exact arm64 builds: ${supportedSpotifyVersions().join(", ")}`,
    );
  }
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function cloneDirectoryCow(source: string, destination: string): void {
  rmSync(destination, { recursive: true, force: true });
  const clone = Bun.spawnSync(["cp", "-cR", source, destination], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (clone.exitCode !== 0) {
    throw new Error(`copy-on-write clone failed: ${clone.stderr.toString().trim()}`);
  }
}

export function cloneSpotifyLoginState(
  appSupportDest: string,
  sourceDir = AUTH_STATE_DIR,
): LoginStateCloneResult {
  // Runtime snapshots must not race logout/import. Explicit official sources
  // are used by auth operations that already own the destination's lock.
  const lock = sourceDir === AUTH_STATE_DIR ? acquireAuthStateLock() : undefined;
  try {
    return copySpotifyLoginState(appSupportDest, sourceDir);
  } finally {
    lock?.release();
  }
}

function copySpotifyLoginState(appSupportDest: string, sourceDir: string): LoginStateCloneResult {
  ensurePrivateDir(appSupportDest);
  let copiedPrefs = false;
  let copiedUsers = false;
  let copiedSessionCache = false;

  const prefsPath = join(sourceDir, "prefs");
  if (existsSync(prefsPath)) {
    copyFileSync(prefsPath, join(appSupportDest, "prefs"));
    copiedPrefs = true;
  }

  const usersPath = join(sourceDir, "Users");
  if (existsSync(usersPath)) {
    const dest = join(appSupportDest, "Users");
    rmSync(dest, { recursive: true, force: true });
    cpSync(usersPath, dest, { recursive: true });
    copiedUsers = true;
  }

  const sessionCacheUsers = join(sourceDir, "PersistentCache/Users");
  if (existsSync(sessionCacheUsers)) {
    const persistentCacheDest = join(appSupportDest, "PersistentCache");
    ensurePrivateDir(persistentCacheDest);
    cloneDirectoryCow(sessionCacheUsers, join(persistentCacheDest, "Users"));
    copiedSessionCache = true;

    const userSettings = join(sourceDir, "PersistentCache/user_settings");
    if (existsSync(userSettings)) {
      copyFileSync(userSettings, join(persistentCacheDest, "user_settings"));
    }
  }

  return { copiedPrefs, copiedUsers, copiedSessionCache };
}

export function descendantPidsFromProcessTable(rootPid: number, table: string): number[] {
  const children = new Map<number, number[]>();
  for (const line of table.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const list = children.get(ppid) ?? [];
    list.push(pid);
    children.set(ppid, list);
  }

  const descendants: number[] = [];
  const visit = (pid: number) => {
    for (const child of children.get(pid) ?? []) visit(child);
    if (pid !== rootPid) descendants.push(pid);
  };
  visit(rootPid);
  return descendants;
}

export function collectDescendantPids(rootPid: number): number[] {
  const ps = Bun.spawnSync(["ps", "-axo", "pid=,ppid="], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (ps.exitCode !== 0) return [];
  return descendantPidsFromProcessTable(rootPid, ps.stdout.toString());
}

export interface ProcessTreeTerminationOptions {
  collectDescendants?: (rootPid: number) => number[];
  beforeSignal?: (targetPid: number, signal: NodeJS.Signals) => void;
  kill?: (targetPid: number, signal: NodeJS.Signals) => void;
  wait?: (ms: number) => Promise<unknown>;
}

export async function terminateProcessTree(
  rootPid: number,
  rootExited?: Promise<number>,
  options: ProcessTreeTerminationOptions = {},
): Promise<void> {
  const collect = options.collectDescendants ?? collectDescendantPids;
  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  const wait = options.wait ?? Bun.sleep;
  const targets = [...collect(rootPid), rootPid];
  const signal = (targetPid: number, signalName: NodeJS.Signals) => {
    options.beforeSignal?.(targetPid, signalName);
    try { kill(targetPid, signalName); } catch {}
  };
  for (const targetPid of targets) signal(targetPid, "SIGTERM");
  await Promise.race([rootExited ?? wait(750), wait(750)]).catch(() => undefined);
  for (const targetPid of targets) signal(targetPid, "SIGKILL");
  if (rootExited) {
    await Promise.race([rootExited, wait(250)]).catch(() => undefined);
  }
}
