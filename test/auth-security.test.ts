import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runCli(home: string, args: string[]) {
  const proc = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, HOME: home },
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
  const escapedPath = join(home, "Library/Application Support/escape");

  expect(result.exitCode).not.toBe(0);
  expect(Bun.file(escapedPath).size).toBe(0);
});

test("auth export creates owner-only credential snapshots", async () => {
  const home = mkdtempSync(join(tmpdir(), "soggfy-auth-export-"));
  roots.push(home);
  const spotifyDir = join(home, "Library/Application Support/Spotify");
  mkdirSync(spotifyDir, { recursive: true });
  writeFileSync(join(spotifyDir, "prefs"), 'autologin.username="test-user"\n');
  const outputPath = join(home, "auth.json");

  const result = await runCli(home, ["auth", "export", outputPath]);
  expect(result.exitCode).toBe(0);
  expect(statSync(outputPath).mode & 0o777).toBe(0o600);
});
