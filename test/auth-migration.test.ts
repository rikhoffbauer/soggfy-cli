import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  markOfficialSpotifyAuthMigrationComplete,
  migrateOfficialSpotifyAuthOnce,
} from "../src/core/auth-migration";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soggfy-auth-migrate-"));
  roots.push(root);
  const authDir = join(root, "owned-parent");
  const authStateDir = join(authDir, "spotify");
  const officialSupportDir = join(root, "official");
  const officialWebKitDir = join(root, "official-webkit");
  const markerPath = join(authDir, ".official-import-v1");
  mkdirSync(join(officialSupportDir, "Users/u"), { recursive: true });
  mkdirSync(join(officialSupportDir, "PersistentCache/Users/u"), { recursive: true });
  writeFileSync(join(officialSupportDir, "prefs"), 'autologin.username="user"\n');
  writeFileSync(join(officialSupportDir, "Users/u/prefs"), "user-state");
  writeFileSync(join(officialSupportDir, "PersistentCache/Users/u/session"), "session-state");
  mkdirSync(join(officialWebKitDir, "WebsiteData"), { recursive: true });
  writeFileSync(join(officialWebKitDir, "WebsiteData/session"), "webkit-state");
  return { authDir, authStateDir, officialSupportDir, officialWebKitDir, markerPath };
}

test("first runtime after auth isolation migrates an existing official Spotify login once", () => {
  const paths = fixture();
  expect(migrateOfficialSpotifyAuthOnce(paths)).toBe("migrated");
  expect(readFileSync(join(paths.authStateDir, "prefs"), "utf8")).toContain('autologin.username="user"');
  expect(readFileSync(join(paths.authStateDir, "PersistentCache/Users/u/session"), "utf8")).toBe("session-state");
  expect(readFileSync(join(paths.authStateDir, "WebKit/com.spotify.client/WebsiteData/session"), "utf8")).toBe("webkit-state");
  expect(existsSync(paths.markerPath)).toBe(true);
});



test("existing owned auth is upgraded with WebKit state only for the same Spotify account", () => {
  const paths = fixture();
  mkdirSync(join(paths.authStateDir, "Users/u"), { recursive: true });
  writeFileSync(join(paths.authStateDir, "prefs"), 'autologin.username="user"\n');
  writeFileSync(join(paths.authStateDir, "Users/u/prefs"), "owned-state");

  expect(migrateOfficialSpotifyAuthOnce(paths)).toBe("upgraded");
  expect(readFileSync(join(paths.authStateDir, "WebKit/com.spotify.client/WebsiteData/session"), "utf8")).toBe("webkit-state");
});

test("existing owned auth never mixes WebKit state from a different official account", () => {
  const paths = fixture();
  mkdirSync(join(paths.authStateDir, "Users/u"), { recursive: true });
  writeFileSync(join(paths.authStateDir, "prefs"), 'autologin.username="other-user"\n');
  writeFileSync(join(paths.authStateDir, "Users/u/prefs"), "owned-state");

  expect(migrateOfficialSpotifyAuthOnce(paths)).toBe("existing");
  expect(existsSync(join(paths.authStateDir, "WebKit"))).toBe(false);
});

test("logout suppression marker prevents silently reimporting the official account", () => {
  const paths = fixture();
  markOfficialSpotifyAuthMigrationComplete(paths.markerPath);
  expect(migrateOfficialSpotifyAuthOnce(paths)).toBe("suppressed");
  expect(existsSync(paths.authStateDir)).toBe(false);
});

test("an official profile without autologin identity is not migrated", () => {
  const paths = fixture();
  writeFileSync(join(paths.officialSupportDir, "prefs"), "app.last-launched-version=1\n");
  expect(migrateOfficialSpotifyAuthOnce(paths)).toBe("unavailable");
  expect(existsSync(paths.authStateDir)).toBe(false);
  expect(existsSync(paths.markerPath)).toBe(false);
});

test("an explicit SOGGFY_HOME never automatically imports the official profile", async () => {
  const paths = fixture();
  const home = join(paths.authDir, "..");
  const official = join(home, "Library/Application Support/Spotify");
  mkdirSync(join(official, "Users/u"), { recursive: true });
  writeFileSync(join(official, "prefs"), 'autologin.username="official-user"\n');
  writeFileSync(join(official, "Users/u/prefs"), "official-state");
  const isolated = join(home, "isolated");
  const proc = Bun.spawn([process.execPath, "-e", 'import {migrateOfficialSpotifyAuthOnce} from "./src/core/auth-migration"; console.log(migrateOfficialSpotifyAuthOnce())'], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, HOME: home, SOGGFY_HOME: isolated },
    stdout: "pipe", stderr: "pipe",
  });
  const [code, output] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  expect(code).toBe(0);
  expect(output.trim()).toBe("suppressed");
  expect(existsSync(join(isolated, "auth/spotify"))).toBe(false);
});

test("default-equivalent explicit SOGGFY_HOME still upgrades same-account WebKit state", async () => {
  const home = mkdtempSync(join(tmpdir(), "soggfy-auth-default-home-"));
  roots.push(home);
  const soggfyHome = join(home, ".soggfy");
  const owned = join(soggfyHome, "auth/spotify");
  const official = join(home, "Library/Application Support/Spotify");
  const webkit = join(home, "Library/WebKit/com.spotify.client/WebsiteData");
  mkdirSync(join(owned, "Users/u"), { recursive: true });
  mkdirSync(join(official, "Users/u"), { recursive: true });
  mkdirSync(webkit, { recursive: true });
  writeFileSync(join(owned, "prefs"), 'autologin.username="user"\n');
  writeFileSync(join(official, "prefs"), 'autologin.username="user"\n');
  writeFileSync(join(official, "Users/u/prefs"), "official-state");
  writeFileSync(join(webkit, "session"), "webkit-state");

  const proc = Bun.spawn([process.execPath, "-e", 'import {migrateOfficialSpotifyAuthOnce} from "./src/core/auth-migration"; console.log(migrateOfficialSpotifyAuthOnce())'], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, HOME: home, SOGGFY_HOME: soggfyHome },
    stdout: "pipe", stderr: "pipe",
  });
  const [code, output] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  expect(code).toBe(0);
  expect(output.trim()).toBe("upgraded");
  expect(readFileSync(join(owned, "WebKit/com.spotify.client/WebsiteData/session"), "utf8")).toBe("webkit-state");
});
