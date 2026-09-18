import { mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { isLoopbackPortAvailable, SpotifyInstance } from "../../../src/core/instance.ts";
import { ping } from "../../../src/core/ipc.ts";
import { IPC_SOCKET } from "../../../src/core/paths.ts";

const repo = resolve(import.meta.dir, "../../..");
const appPath = process.env.SOGGFY_INVESTIGATION_APP
  ?? "/Volumes/ssd1/tmp/Spotify-1.3.0.277-Soggfy.app";
const base = process.env.SOGGFY_BENCH_DIR
  ?? "/Volumes/ssd1/tmp/soggfy-prefetch-benchmark";
const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");
const pairs = Number(process.env.SOGGFY_BENCH_PAIRS ?? "1");
const trackId = process.env.SOGGFY_BENCH_TRACK ?? "05UwCkSH4WUgVGokcJuCdC";
const fileId = process.env.SOGGFY_BENCH_FILE ?? "f38702bf00c1b1271576c399dbc5713f2412132a";
const formatEnum = Number(process.env.SOGGFY_BENCH_FORMAT ?? "1");

if (!Number.isInteger(pairs) || pairs < 1 || pairs > 10) throw new Error("SOGGFY_BENCH_PAIRS must be 1..10");

type Json = Record<string, any>;

async function run(argv: string[], env: Record<string, string> = {}, timeoutMs = 90_000) {
  const child = Bun.spawn(argv, {
    cwd: repo,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => {
    try { child.kill("SIGTERM"); } catch {}
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(`${argv.join(" ")} failed (${code})\n${stderr || stdout}`);
  return { stdout, stderr, code };
}

async function jsonProbe(name: string, args: string[], env: Record<string, string>) {
  const result = await run(["bun", join(import.meta.dir, name), ...args], env);
  const text = result.stdout.trim();
  try { return JSON.parse(text) as Json; }
  catch { throw new Error(`${name} did not return JSON:\n${text}\n${result.stderr}`); }
}

async function daemonStatusText() {
  const result = await run(["bun", "src/cli.ts", "daemon", "status"], { SOGGFY_HOST: "127.0.0.1" }, 15_000).catch(error => ({
    stdout: "", stderr: String(error), code: 1,
  }));
  return `${result.stdout}\n${result.stderr}`.trim();
}

async function waitNormalDaemonHealthy(timeoutMs = 45_000) {
  const started = performance.now();
  let last = "";
  while (performance.now() - started < timeoutMs) {
    const status = await daemonStatusText();
    last = status;
    if (status.includes("Daemon running") && status.includes("Spotify IPC: responsive")
      && status.includes("Web UI/API: responsive")) return status;
    await Bun.sleep(500);
  }
  throw new Error(`normal daemon did not become healthy after restoration:\n${last}`);
}

async function stopDaemon() {
  await run(["bun", "src/cli.ts", "daemon", "stop"], { SOGGFY_HOST: "127.0.0.1" }, 20_000);
  for (let i = 0; i < 40 && await ping(IPC_SOCKET).catch(() => false); i++) await Bun.sleep(100);
  for (let i = 0; i < 50 && !(await isLoopbackPortAvailable(7768)); i++) await Bun.sleep(100);
  if (!(await isLoopbackPortAvailable(7768))) throw new Error("Spotify local-control port 7768 did not become available");
}

async function startDaemon() {
  await run(["bun", "src/cli.ts", "daemon", "start"], { SOGGFY_HOST: "127.0.0.1" }, 110_000);
  return waitNormalDaemonHealthy();
}

async function oneTrial(kind: "cold" | "prefetched", ordinal: number) {
  const id = `${String(ordinal).padStart(2, "0")}-${kind}`;
  const savePath = join(base, id, "save");
  const profilePath = join(base, id, "profile");
  const socketPath = `/tmp/soggfy-prefetch-${process.pid}-${ordinal}.sock`;
  rmSync(join(base, id), { recursive: true, force: true });
  mkdirSync(savePath, { recursive: true });
  mkdirSync(profilePath, { recursive: true });

  const instance = new SpotifyInstance(socketPath, savePath, profilePath, { appPath, debugPort });
  const env = {
    SOGGFY_INVESTIGATION_SOCKET: socketPath,
    SOGGFY_INVESTIGATION_CDP: String(debugPort),
  };

  const startedAt = new Date().toISOString();
  try {
    await instance.start();
    await jsonProbe("wait-renderer.ts", ["PlayerAPI", "PlaybackAPI", "EsperantoTransport"], env);
    const cacheBefore = await jsonProbe("cache-status.ts", [fileId, String(formatEnum)], env);
    if (cacheBefore.cached !== false) throw new Error(`${id}: expected fresh cache miss`);

    let prefetch: Json | null = null;
    let prefetchWallMs = 0;
    if (kind === "prefetched") {
      const t0 = performance.now();
      prefetch = await jsonProbe("fill-cache.ts", [
        fileId,
        String(formatEnum),
        `spotify:track:${trackId}`,
      ], env);
      prefetchWallMs = performance.now() - t0;
      if (!prefetch.afterCached) throw new Error(`${id}: exact variant did not become cached`);
    }

    const cacheAtCapture = await jsonProbe("cache-status.ts", [fileId, String(formatEnum)], env);
    if (kind === "prefetched" && !cacheAtCapture.cached) {
      throw new Error(`${id}: cache entry evicted before capture`);
    }
    if (kind === "cold" && cacheAtCapture.cached) {
      throw new Error(`${id}: cold trial became cached before capture`);
    }

    const capture = await jsonProbe("capture-fixture.ts", [trackId, fileId], env);
    if (capture.identity?.fileId !== fileId) throw new Error(`${id}: selected playback variant mismatch`);

    const cacheAfter = await jsonProbe("cache-status.ts", [fileId, String(formatEnum)], env);
    return {
      id,
      kind,
      startedAt,
      cacheBefore,
      prefetch,
      prefetchWallMs,
      cacheAtCapture,
      capture,
      cacheAfter,
    };
  } finally {
    await instance.stop().catch(() => undefined);
    for (let i = 0; i < 50 && !(await isLoopbackPortAvailable(7768)); i++) await Bun.sleep(100);
  }
}

const daemonBefore = await daemonStatusText();
const daemonWasRunning = daemonBefore.includes("Daemon running");
const results: Json[] = [];
let restoreStatus = "";

try {
  if (daemonWasRunning) await stopDaemon();
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });

  let ordinal = 0;
  for (let pair = 0; pair < pairs; pair++) {
    const order: Array<"cold" | "prefetched"> = pair % 2 === 0
      ? ["cold", "prefetched"]
      : ["prefetched", "cold"];
    for (const kind of order) results.push(await oneTrial(kind, ++ordinal));
  }
} finally {
  if (daemonWasRunning) restoreStatus = await startDaemon();
}

const cold = results.filter(x => x.kind === "cold").map(x => x.capture.elapsedMs as number);
const warm = results.filter(x => x.kind === "prefetched").map(x => x.capture.elapsedMs as number);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const coldMedian = median(cold);
const warmMedian = median(warm);
const improvement = coldMedian && warmMedian ? (coldMedian - warmMedian) / coldMedian : null;

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  appPath,
  trackId,
  fileId,
  formatEnum,
  pairs,
  daemonBefore,
  restoreStatus,
  summary: {
    coldMs: cold,
    prefetchedExtractionMs: warm,
    coldMedianMs: coldMedian,
    prefetchedExtractionMedianMs: warmMedian,
    extractionImprovementFraction: improvement,
  },
  results,
};

const resultPath = join(repo, "investigations/spotify-1.3.0.277-streamer/results/same-file-benchmark.json");
await Bun.write(resultPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ resultPath, summary: output.summary }, null, 2));
