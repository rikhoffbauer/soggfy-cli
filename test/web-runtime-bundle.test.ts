import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer } from "node:net";

const root = join(import.meta.dir, "..");
const scratch: string[] = [];
afterAll(() => scratch.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForHealth(origin: string): Promise<Response> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) {
        const body = await response.clone().json() as { started?: boolean };
        if (body.started === true) return response;
      }
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Bundled web runtime did not become healthy");
}

test("built web runtime serves API and UI outside the source checkout", async () => {
  const build = Bun.spawnSync([process.execPath, "run", "build:web-runtime"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(build.exitCode, build.stderr.toString()).toBe(0);

  const releaseRoot = mkdtempSync(join(tmpdir(), "soggfy-web-release-"));
  const home = mkdtempSync(join(tmpdir(), "soggfy-web-home-"));
  scratch.push(releaseRoot, home);
  const webDir = join(releaseRoot, "webapp");
  cpSync(join(root, "dist/webapp"), webDir, { recursive: true });
  const soggfyHome = join(home, ".soggfy");
  const outputDir = join(soggfyHome, "output");
  mkdirSync(outputDir, { recursive: true });
  const persistedTrack = "6HSXNV0b4M4cLJ7ljgVVeh";
  const persistedAudio = join(outputDir, `${persistedTrack}.mp3`);
  writeFileSync(persistedAudio, "persisted-audio");
  writeFileSync(`${persistedAudio}.json`, JSON.stringify({
    jobId: "persisted-job", trackId: persistedTrack, outputFormat: "mp3",
    completedAt: "2026-09-10T08:00:00.000Z", metadata: { title: "Persisted" },
  }));
  const port = await freePort();
  const bootstrap = join(releaseRoot, "bootstrap.ts");
  await Bun.write(bootstrap, `
    const fake = { isReady: true, process: null, sendCommand: async (command) => command === "ping" ? "pong" : "ok" };
    globalThis[Symbol.for("soggfy.daemonSpotifyInstance")] = fake;
    await import(${JSON.stringify(join(webDir, "server.js"))});
  `);

  const proc = Bun.spawn([process.execPath, bootstrap], {
    cwd: webDir,
    env: {
      ...process.env,
      HOME: home,
      SOGGFY_HOME: soggfyHome,
      SOGGFY_USE_DAEMON_INSTANCE: "1",
      SOGGFY_HOST: "127.0.0.1",
      SOGGFY_PORT: String(port),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const health = await waitForHealth(`http://127.0.0.1:${port}`);
    expect(await health.json()).toMatchObject({ ok: true, started: true, completedJobs: 1 });
    const ui = await fetch(`http://127.0.0.1:${port}/`);
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain("Soggfy Downloader");
    const initialJobs = await fetch(`http://127.0.0.1:${port}/api/jobs`);
    const snapshot = await initialJobs.json() as { revision: number };
    const unchanged = await fetch(`http://127.0.0.1:${port}/api/jobs?since=${snapshot.revision}`);
    expect(unchanged.status).toBe(204);
  } finally {
    proc.kill("SIGTERM");
    await proc.exited;
  }
});
