import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { acquireAuthStateLock } from "../src/core/auth-lock";
import {
  assertSupportedSpotifyBundle,
  cloneSpotifyLoginState,
  descendantPidsFromProcessTable,
  readSpotifyBundleVersion,
  SUPPORTED_SPOTIFY_VERSION,
  terminateProcessTree,
} from "../src/core/spotify-runtime";

const root = join("/tmp", `soggfy-runtime-test-${process.pid}`);
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("cloneSpotifyLoginState copies only session-critical state", () => {
  const source = join(root, "source");
  const dest = join(root, "dest");
  mkdirSync(join(source, "Users/u"), { recursive: true });
  mkdirSync(join(source, "PersistentCache/Users/u/db"), { recursive: true });
  mkdirSync(join(source, "PersistentCache/Update"), { recursive: true });
  writeFileSync(join(source, "prefs"), "prefs");
  writeFileSync(join(source, "Users/u/login"), "login");
  writeFileSync(join(source, "PersistentCache/Users/u/db/session"), "session");
  writeFileSync(join(source, "PersistentCache/user_settings"), "settings");
  writeFileSync(join(source, "PersistentCache/Update/huge"), "do-not-copy");
  const sourceWebKit = join(root, "source-webkit");
  const webKitDest = join(root, "home/Library/WebKit/com.spotify.client");
  mkdirSync(join(sourceWebKit, "WebsiteData"), { recursive: true });
  writeFileSync(join(sourceWebKit, "WebsiteData/session"), "webkit-session");

  const result = cloneSpotifyLoginState(dest, source, { webKitSourceDir: sourceWebKit, webKitDest });
  expect(result).toEqual({ copiedPrefs: true, copiedUsers: true, copiedSessionCache: true, copiedWebKit: true });
  expect(existsSync(join(dest, "prefs"))).toBe(true);
  expect(existsSync(join(dest, "Users/u/login"))).toBe(true);
  expect(existsSync(join(dest, "PersistentCache/Users/u/db/session"))).toBe(true);
  expect(existsSync(join(dest, "PersistentCache/user_settings"))).toBe(true);
  expect(existsSync(join(dest, "PersistentCache/Update"))).toBe(false);
  expect(readFileSync(join(webKitDest, "WebsiteData/session"), "utf8")).toBe("webkit-session");
});


test("cloneSpotifyLoginState clears stale runtime WebKit state when the selected snapshot lacks it", () => {
  const source = join(root, "source-without-webkit");
  const dest = join(root, "runtime-support");
  const webKitDest = join(root, "runtime-home/Library/WebKit/com.spotify.client");
  mkdirSync(join(source, "Users/u"), { recursive: true });
  writeFileSync(join(source, "prefs"), 'autologin.username="account-b"\n');
  writeFileSync(join(source, "Users/u/login"), "account-b");
  mkdirSync(join(webKitDest, "WebsiteData"), { recursive: true });
  writeFileSync(join(webKitDest, "WebsiteData/session"), "stale-account-a-session");

  const result = cloneSpotifyLoginState(dest, source, { webKitDest });

  expect(result.copiedWebKit).toBe(false);
  expect(existsSync(webKitDest)).toBe(false);
});

test("runtime login clones lock owned auth state without relocking explicit import sources", async () => {
  const owned = join(root, "auth/spotify");
  const explicit = join(root, "official");
  const dest = join(root, "dest");
  mkdirSync(owned, { recursive: true });
  mkdirSync(explicit, { recursive: true });
  writeFileSync(join(owned, "prefs"), "owned-state");
  writeFileSync(join(explicit, "prefs"), "explicit-state");
  const run = async (source: string) => {
    const proc = Bun.spawn([process.execPath, "-e", 'import {cloneSpotifyLoginState} from "./src/core/spotify-runtime"; cloneSpotifyLoginState(process.env.TEST_DEST, process.env.TEST_SOURCE || undefined);'], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, SOGGFY_HOME: root, TEST_DEST: dest, TEST_SOURCE: source },
      stdout: "ignore", stderr: "pipe",
    });
    const [code, error] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    return { code, error };
  };
  const lock = acquireAuthStateLock(join(root, "auth/.state.lock"));
  try {
    const blocked = await run("");
    expect(blocked.code).not.toBe(0);
    expect(blocked.error).toContain("Auth state is busy");
    expect(existsSync(dest)).toBe(false);
    expect((await run(explicit)).code).toBe(0);
    expect(await Bun.file(join(dest, "prefs")).text()).toBe("explicit-state");
  } finally {
    lock.release();
  }
  expect((await run("")).code).toBe(0);
  expect(await Bun.file(join(dest, "prefs")).text()).toBe("owned-state");
});

test("descendantPidsFromProcessTable returns deepest children first", () => {
  const table = `10 1\n11 10\n12 10\n13 11\n20 1\n`;
  expect(descendantPidsFromProcessTable(10, table)).toEqual([13, 11, 12]);
});


test("supported Spotify bundle version is read and enforced", () => {
  const versionRoot = join(root, "version-app");
  const contents = join(versionRoot, "Contents");
  mkdirSync(contents, { recursive: true });
  writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${SUPPORTED_SPOTIFY_VERSION}</string></dict></plist>`);
  expect(readSpotifyBundleVersion(versionRoot)).toBe(SUPPORTED_SPOTIFY_VERSION);
  expect(() => assertSupportedSpotifyBundle(versionRoot)).not.toThrow();
  writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>0.0.0</string></dict></plist>`);
  expect(() => assertSupportedSpotifyBundle(versionRoot)).toThrow("Unsupported Spotify build 0.0.0");
});


test("production support guard is registry-backed", () => {
  const source = require("fs").readFileSync(join(import.meta.dir, "../src/core/spotify-runtime.ts"), "utf8");
  expect(source).toContain("isSpotifyVersionSupported(version)");
  expect(source).toContain("supportedSpotifyVersions()");
});


test("runtime client-version metadata has a non-throwing empty-registry fallback", () => {
  const source = require("fs").readFileSync(join(import.meta.dir, "../src/core/spotify-runtime.ts"), "utf8");
  expect(source).toContain('latestSupportedSpotifyVersion() ?? "0.0.0"');
});


test("terminateProcessTree runs its identity guard immediately before every signal", async () => {
  const events: string[] = [];
  await terminateProcessTree(10, undefined, {
    collectDescendants: () => [11],
    wait: async () => {},
    beforeSignal: (targetPid, signal) => events.push(`guard:${targetPid}:${signal}`),
    kill: (targetPid, signal) => events.push(`kill:${targetPid}:${signal}`),
  });
  expect(events).toEqual([
    "guard:11:SIGTERM", "kill:11:SIGTERM",
    "guard:10:SIGTERM", "kill:10:SIGTERM",
    "guard:11:SIGKILL", "kill:11:SIGKILL",
    "guard:10:SIGKILL", "kill:10:SIGKILL",
  ]);
});
