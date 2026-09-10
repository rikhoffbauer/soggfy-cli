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
  const markerPath = join(authDir, ".official-import-v1");
  mkdirSync(join(officialSupportDir, "Users/u"), { recursive: true });
  mkdirSync(join(officialSupportDir, "PersistentCache/Users/u"), { recursive: true });
  writeFileSync(join(officialSupportDir, "prefs"), 'autologin.username="user"\n');
  writeFileSync(join(officialSupportDir, "Users/u/prefs"), "user-state");
  writeFileSync(join(officialSupportDir, "PersistentCache/Users/u/session"), "session-state");
  return { authDir, authStateDir, officialSupportDir, markerPath };
}

test("first runtime after auth isolation migrates an existing official Spotify login once", () => {
  const paths = fixture();
  expect(migrateOfficialSpotifyAuthOnce(paths)).toBe("migrated");
  expect(readFileSync(join(paths.authStateDir, "prefs"), "utf8")).toContain('autologin.username="user"');
  expect(readFileSync(join(paths.authStateDir, "PersistentCache/Users/u/session"), "utf8")).toBe("session-state");
  expect(existsSync(paths.markerPath)).toBe(true);
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
