import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { acquireAuthStateLock } from "../src/core/auth-lock";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runCli(home: string, args: string[]) {
  const proc = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, HOME: home, SOGGFY_HOME: join(home, ".soggfy") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
test("auth import rejects user paths that escape Spotify Users", async () => {
  const home = mkdtempSync(join(tmpdir(), "soggfy-auth-import-"));
  roots.push(home);
  const snapshotPath = join(home, "malicious.json");
  writeFileSync(snapshotPath, JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    prefs: null,
    users: { "../../escape": Buffer.from("owned").toString("base64") },
  }));

  const result = await runCli(home, ["auth", "import", snapshotPath]);
  const escapedPath = join(home, ".soggfy/auth/escape");

  expect(result.exitCode).not.toBe(0);
  expect(Bun.file(escapedPath).size).toBe(0);
});

test("auth export creates owner-only credential snapshots", async () => {
  const home = mkdtempSync(join(tmpdir(), "soggfy-auth-export-"));
  roots.push(home);
  const spotifyDir = join(home, ".soggfy/auth/spotify");
  mkdirSync(spotifyDir, { recursive: true });
  writeFileSync(join(spotifyDir, "prefs"), 'autologin.username="test-user"\n');
  const outputPath = join(home, "auth.json");

  const result = await runCli(home, ["auth", "export", outputPath]);
  expect(result.exitCode).toBe(0);
  expect(statSync(outputPath).mode & 0o777).toBe(0o600);
});


test("auth logout removes only Soggfy-owned credentials", async () => {
  const home = mkdtempSync(join(tmpdir(), "soggfy-auth-logout-"));
  roots.push(home);
  const official = join(home, "Library/Application Support/Spotify");
  const owned = join(home, ".soggfy/auth/spotify");
  mkdirSync(official, { recursive: true });
  mkdirSync(owned, { recursive: true });
  writeFileSync(join(official, "prefs"), "official");
  writeFileSync(join(owned, "prefs"), "owned");

  const result = await runCli(home, ["auth", "logout"]);
  expect(result.exitCode).toBe(0);
  expect(await Bun.file(join(official, "prefs")).text()).toBe("official");
  expect(Bun.file(join(owned, "prefs")).size).toBe(0);
  expect(Bun.file(join(home, ".soggfy/auth/.official-import-v1")).size).toBeGreaterThan(0);
});


test("auth logout refuses to race a live auth-state mutation", async () => {
  const home = mkdtempSync(join(tmpdir(), "soggfy-auth-logout-lock-"));
  roots.push(home);
  const authDir = join(home, ".soggfy/auth");
  const owned = join(authDir, "spotify");
  mkdirSync(owned, { recursive: true });
  writeFileSync(join(owned, "prefs"), "owned");
  const lock = acquireAuthStateLock(join(authDir, ".state.lock"));
  try {
    const result = await runCli(home, ["auth", "logout"]);
    expect(result.exitCode).not.toBe(0);
    expect(await Bun.file(join(owned, "prefs")).text()).toBe("owned");
  } finally {
    lock.release();
  }
});

test("auth export refuses to read a snapshot during a live auth-state mutation", async () => {
  const home = mkdtempSync(join(tmpdir(), "soggfy-auth-export-lock-"));
  roots.push(home);
  const authDir = join(home, ".soggfy/auth");
  mkdirSync(join(authDir, "spotify"), { recursive: true });
  writeFileSync(join(authDir, "spotify/prefs"), "owned");
  const lock = acquireAuthStateLock(join(authDir, ".state.lock"));
  try {
    const result = await runCli(home, ["auth", "export", join(home, "snapshot.json")]);
    expect(result.exitCode).not.toBe(0);
    expect(await Bun.file(join(home, "snapshot.json")).exists()).toBe(false);
  } finally {
    lock.release();
  }
});
