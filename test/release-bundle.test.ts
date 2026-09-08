import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const root = join(import.meta.dir, "..");
const outDir = mkdtempSync(join(tmpdir(), "soggfy-release-test-"));
const bundle = join(outDir, "soggfy");

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

function buildReleaseCli(): void {
  const result = Bun.spawnSync([
    process.execPath,
    "build",
    "src/cli.ts",
    "--outfile",
    bundle,
    "--target",
    "bun",
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
}

test("bundled CLI does not depend on source-tree cli.ts paths", () => {
  buildReleaseCli();
  const source = readFileSync(bundle, "utf8");
  expect(source).not.toContain("../cli.ts");
});

test("bundled daemon start re-executes the bundle instead of source files", async () => {
  buildReleaseCli();
  const home = mkdtempSync(join(tmpdir(), "soggfy-bundled-home-"));
  try {
    const proc = Bun.spawn([process.execPath, bundle, "daemon", "start"], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).not.toContain("Cannot find module");
    const daemonLog = join(home, ".soggfy/logs/daemon.log");
    const logText = readFileSync(daemonLog, "utf8");
    expect(logText).toContain("Patched Spotify binary not found");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
