import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
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

  const result = cloneSpotifyLoginState(dest, source);
  expect(result).toEqual({ copiedPrefs: true, copiedUsers: true, copiedSessionCache: true });
  expect(existsSync(join(dest, "prefs"))).toBe(true);
  expect(existsSync(join(dest, "Users/u/login"))).toBe(true);
  expect(existsSync(join(dest, "PersistentCache/Users/u/db/session"))).toBe(true);
  expect(existsSync(join(dest, "PersistentCache/user_settings"))).toBe(true);
  expect(existsSync(join(dest, "PersistentCache/Update"))).toBe(false);
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
