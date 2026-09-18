import { mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { isLoopbackPortAvailable, SpotifyInstance } from "../../../src/core/instance.ts";
import { ping } from "../../../src/core/ipc.ts";
import { IPC_SOCKET } from "../../../src/core/paths.ts";

const repo = resolve(import.meta.dir, "../../..");
const appPath = process.env.SOGGFY_INVESTIGATION_APP
  ?? "/Volumes/ssd1/tmp/Spotify-1.3.0.277-Soggfy.app";
const base = process.env.SOGGFY_BATCH_BENCH_DIR
  ?? "/Volumes/ssd1/tmp/soggfy-prefetch-batch-benchmark";
const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");
const pairs = Number(process.env.SOGGFY_BATCH_PAIRS ?? "1");
if (!Number.isInteger(pairs) || pairs < 1 || pairs > 10) throw new Error("SOGGFY_BATCH_PAIRS must be 1..10");

const tracks = [
  {
    trackId: "575BKqgHeL2srecj3MfGX1",
    fileId: "56bc9ef82236dc30d6f31d8125fc311b3c2442b9",
    formatEnum: 1,
  },
  {
    trackId: "05UwCkSH4WUgVGokcJuCdC",
    fileId: "f38702bf00c1b1271576c399dbc5713f2412132a",
    formatEnum: 1,
  },
  {
    trackId: "05V8xN0HWfnipAFIlOEu3W",
    fileId: "6c3230af2542446176eb71f54ed0c66000420ef8",
    formatEnum: 1,
  },
] as const;

type Json = Record<string, any>;

async function run(argv: string[], env: Record<string, string> = {}, timeoutMs = 120_000) {
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

function startJsonProbe(name: string, args: string[], env: Record<string, string>) {
  const child = Bun.spawn(["bun", join(import.meta.dir, name), ...args], {
    cwd: repo,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  let done = false;
  const startedAt = performance.now();
  const promise = (async () => {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    done = true;
    const finishedAt = performance.now();
    if (code !== 0) throw new Error(`${name} failed (${code})\n${stderr || stdout}`);
    const text = stdout.trim();
    let value: Json;
    try { value = JSON.parse(text); }
    catch { throw new Error(`${name} did not return JSON:\n${text}\n${stderr}`); }
    return { value, startedAt, finishedAt, wallMs: finishedAt - startedAt };
  })();
  return {
    promise,
    settled: () => done,
    kill: () => { try { child.kill("SIGTERM"); } catch {} },
  };
}

async function daemonStatusText() {
  const result = await run(
    ["bun", "src/cli.ts", "daemon", "status"],
    { SOGGFY_HOST: "127.0.0.1" },
    15_000,
  ).catch(error => ({ stdout: "", stderr: String(error), code: 1 }));
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

async function validateOgg(capture: Json) {
  const fileName = capture.output?.fileName;
  if (typeof fileName !== "string") throw new Error("capture did not expose output filename");
  const result = await run([
    "ffprobe", "-v", "error",
    "-show_entries", "stream=codec_name,channels,sample_rate:format=duration",
    "-of", "json", fileName,
  ], {}, 20_000);
  const probe = JSON.parse(result.stdout);
  const stream = probe.streams?.[0];
  const duration = Number(probe.format?.duration);
  if (stream?.codec_name !== "vorbis" || !Number.isFinite(duration) || duration < 30) {
    throw new Error(`invalid captured Ogg: ${JSON.stringify(probe)}`);
  }
  return {
    codec: stream.codec_name,
    channels: Number(stream.channels),
    sampleRate: Number(stream.sample_rate),
    duration,
  };
}

async function oneTrial(kind: "disabled" | "enabled", ordinal: number) {
  const id = `${String(ordinal).padStart(2, "0")}-${kind}`;
  const savePath = join(base, id, "save");
  const profilePath = join(base, id, "profile");
  const socketPath = `/tmp/soggfy-prefetch-batch-${process.pid}-${ordinal}.sock`;
  rmSync(join(base, id), { recursive: true, force: true });
  mkdirSync(savePath, { recursive: true });
  mkdirSync(profilePath, { recursive: true });

  const instance = new SpotifyInstance(socketPath, savePath, profilePath, { appPath, debugPort });
  const env = {
    SOGGFY_INVESTIGATION_SOCKET: socketPath,
    SOGGFY_INVESTIGATION_CDP: String(debugPort),
  };
  const record: Json = {
    id,
    kind,
    valid: false,
    initialCache: [],
    prefetchFinishedBeforeHandoff: kind === "disabled" ? true : null,
    prefetch: [],
    captures: [],
    validations: [],
  };
  let startedAt: number | null = null;
  let speculative: ReturnType<typeof startJsonProbe>[] = [];
  try {
    await instance.start();
    await jsonProbe("wait-renderer.ts", ["PlayerAPI", "PlaybackAPI", "EsperantoTransport"], env);
    record.rendererReady = true;

    for (const track of tracks) {
      const cache = await jsonProbe("cache-status.ts", [track.fileId, String(track.formatEnum)], env);
      if (cache.cached !== false) throw new Error(`${id}: expected cache miss for ${track.trackId}`);
      record.initialCache.push(cache);
    }

    startedAt = performance.now();

    if (kind === "enabled") {
      speculative = tracks.slice(1).map(track => startJsonProbe(
        "fill-cache.ts",
        [track.fileId, String(track.formatEnum), `spotify:track:${track.trackId}`],
        env,
      ));

      const first = await jsonProbe("capture-fixture.ts", [tracks[0].trackId, tracks[0].fileId], env);
      record.captures.push(first);
      record.validations.push(await validateOgg(first));

      record.prefetchFinishedBeforeHandoff = speculative.every(item => item.settled());
      if (!record.prefetchFinishedBeforeHandoff) {
        for (const item of speculative) if (!item.settled()) item.kill();
        await Promise.allSettled(speculative.map(item => item.promise));
        throw new Error(`${id}: speculative acquisition still active at first handoff; trial invalid`);
      }
      const prefetched = await Promise.all(speculative.map(item => item.promise));
      record.prefetch = prefetched.map((entry, index) => ({
        trackId: tracks[index + 1].trackId,
        fileId: tracks[index + 1].fileId,
        wallMs: entry.wallMs,
        result: entry.value,
      }));
      for (const entry of record.prefetch) {
        if (!entry.result.afterCached) throw new Error(`${id}: prefetch did not complete for ${entry.trackId}`);
      }

      for (const track of tracks.slice(1)) {
        const capture = await jsonProbe("capture-fixture.ts", [track.trackId, track.fileId], env);
        record.captures.push(capture);
        record.validations.push(await validateOgg(capture));
      }
    } else {
      for (const track of tracks) {
        const capture = await jsonProbe("capture-fixture.ts", [track.trackId, track.fileId], env);
        record.captures.push(capture);
        record.validations.push(await validateOgg(capture));
      }
    }

    record.totalMs = performance.now() - startedAt;
    record.selected = record.captures.map((capture: Json, index: number) => ({
      trackId: tracks[index].trackId,
      expectedFileId: tracks[index].fileId,
      actualFileId: capture.identity?.fileId,
      elapsedMs: capture.elapsedMs,
      sha256: capture.output?.sha256,
      bytes: capture.output?.bytes,
    }));
    for (const item of record.selected) {
      if (item.actualFileId !== item.expectedFileId) {
        throw new Error(`${id}: selected variant mismatch for ${item.trackId}`);
      }
    }
    record.valid = true;
    return record;
  } catch (error) {
    if (startedAt !== null && record.totalMs === undefined) {
      record.totalMs = performance.now() - startedAt;
    }
    record.error = error instanceof Error ? error.message : String(error);
    return record;
  } finally {
    for (const item of speculative) if (!item.settled()) item.kill();
    await Promise.allSettled(speculative.map(item => item.promise));
    await instance.stop().catch(() => undefined);
    for (let i = 0; i < 50 && !(await isLoopbackPortAvailable(7768)); i++) await Bun.sleep(100);
    await Bun.write(join(base, id, "trial.json"), JSON.stringify(record, null, 2) + "\n");
  }
}

const daemonBefore = await daemonStatusText();
const daemonWasRunning = daemonBefore.includes("Daemon running");
const pairAttempts: Json[] = [];
const validPairs: Json[] = [];
let restoreStatus = "";
let restoreError: string | null = null;
const maxPairAttempts = Number(process.env.SOGGFY_BATCH_MAX_PAIR_ATTEMPTS ?? String(pairs + 2));
if (!Number.isInteger(maxPairAttempts) || maxPairAttempts < pairs || maxPairAttempts > 20) {
  throw new Error("SOGGFY_BATCH_MAX_PAIR_ATTEMPTS must be an integer between requested pairs and 20");
}

try {
  if (daemonWasRunning) await stopDaemon();
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });

  let ordinal = 0;
  for (let attempt = 0; attempt < maxPairAttempts && validPairs.length < pairs; attempt++) {
    const order: Array<"disabled" | "enabled"> = attempt % 2 === 0
      ? ["disabled", "enabled"]
      : ["enabled", "disabled"];
    const trials: Json[] = [];
    for (const kind of order) trials.push(await oneTrial(kind, ++ordinal));
    const pairAttempt = {
      attempt: attempt + 1,
      order,
      valid: trials.every(trial => trial.valid === true),
      trials,
    };
    pairAttempts.push(pairAttempt);
    if (pairAttempt.valid) validPairs.push(pairAttempt);
  }
} finally {
  if (daemonWasRunning) {
    try { restoreStatus = await startDaemon(); }
    catch (error) { restoreError = error instanceof Error ? error.message : String(error); }
  }
}

const results = pairAttempts.flatMap(pair => pair.trials as Json[]);
const validResults = validPairs.flatMap(pair => pair.trials as Json[]);
const invalidTrials = results.filter(x => x.valid !== true);
const disabled = validResults.filter(x => x.kind === "disabled").map(x => x.totalMs as number);
const enabled = validResults.filter(x => x.kind === "enabled").map(x => x.totalMs as number);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const disabledMedian = median(disabled);
const enabledMedian = median(enabled);
const improvement = disabledMedian && enabledMedian ? (disabledMedian - enabledMedian) / disabledMedian : null;

const hashSets = tracks.map((track, index) => ({
  trackId: track.trackId,
  hashes: [...new Set(validResults.map(result => result.selected?.[index]?.sha256).filter(Boolean))],
}));

const paired = validPairs.map((pair, index) => {
  const pairResults = pair.trials as Json[];
  const off = pairResults.find((x: Json) => x.kind === "disabled");
  const on = pairResults.find((x: Json) => x.kind === "enabled");
  const improvementFraction = off && on ? (off.totalMs - on.totalMs) / off.totalMs : null;
  return {
    pair: index + 1,
    sourceAttempt: pair.attempt,
    disabledMs: off?.totalMs,
    enabledMs: on?.totalMs,
    improvementFraction,
  };
});
const enoughValidPairs = validPairs.length === pairs;
const allPairsImproved = enoughValidPairs && paired.every(pair => (pair.improvementFraction ?? -1) > 0);
const exactOutputsStable = hashSets.every(entry => entry.hashes.length === 1);
const gateDecision = !enoughValidPairs
  ? "INCONCLUSIVE"
  : improvement !== null && improvement >= 0.10 && allPairsImproved
    && exactOutputsStable && invalidTrials.length === 0
    ? "GO"
    : "NO-GO";

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  appPath,
  tracks,
  pairs,
  maxPairAttempts,
  daemonBefore,
  restoreStatus,
  restoreError,
  summary: {
    gateDecision,
    validPairs: validPairs.length,
    invalidTrials: invalidTrials.map(trial => ({ id: trial.id, kind: trial.kind, error: trial.error })),
    disabledMs: disabled,
    enabledMs: enabled,
    disabledMedianMs: disabledMedian,
    enabledMedianMs: enabledMedian,
    medianImprovementFraction: improvement,
    allPairsImproved,
    exactOutputsStable,
    hashSets,
    paired,
  },
  pairAttempts,
  results,
};

const resultPath = join(repo, "investigations/spotify-1.3.0.277-streamer/results/batch-benchmark.json");
await Bun.write(resultPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ resultPath, summary: output.summary }, null, 2));
if (restoreError) throw new Error(restoreError);
