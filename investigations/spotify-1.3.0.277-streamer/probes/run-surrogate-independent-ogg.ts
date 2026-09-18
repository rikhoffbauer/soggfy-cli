import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateAudioFile } from "../../../src/core/media.ts";
import {
  FileCaptureSink,
  MemoryCaptureSink,
  MemoryEncodedSource,
  runIndependentOggCapture,
  runParallelOggCaptures,
  type IndependentCaptureResult,
} from "../../../src/dev/independent-ogg-pipeline.ts";
import {
  evaluateSurrogateC3a,
  evaluateSurrogateC3b,
  evaluateSurrogateC4,
  type RecoverableLifecycleCase,
  type SurrogateC3bEvidence,
} from "../../../src/dev/surrogate-native-source-gates.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function generateFixture(path: string, frequency: number, durationSeconds: number) {
  const result = spawnSync("ffmpeg", [
    "-v", "error",
    "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${durationSeconds}`,
    "-ac", "2",
    "-c:a", "libopus",
    "-b:a", "96k",
    "-y",
    path,
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg fixture generation failed: ${result.stderr || result.stdout}`);
  }
}

function terminalContained(
  result: IndependentCaptureResult,
  expected: "cancelled" | "failed" | "completed",
): boolean {
  return result.state === expected && result.lateWritesAfterTeardown === 0;
}

async function peerCapture(
  id: number,
  bytes: Uint8Array,
): Promise<IndependentCaptureResult> {
  return await runIndependentOggCapture({
    contextId: id,
    source: new MemoryEncodedSource(`peer-${id}`, bytes, {
      chunkBytes: 512,
      delayMs: 1,
    }),
    sink: new MemoryCaptureSink(),
  });
}

async function runFaultWithPeer(
  name: RecoverableLifecycleCase,
  fault: () => Promise<IndependentCaptureResult>,
  peerBytes: Uint8Array,
  expected: "cancelled" | "failed" | "completed",
): Promise<SurrogateC3bEvidence["recoverable"][RecoverableLifecycleCase]> {
  const [faultResult, peer] = await Promise.all([
    fault(),
    peerCapture(100 + Object.keys({
      cancel_startup: 1,
      cancel_consuming: 2,
      source_read_failure: 3,
      writer_failure: 4,
      timeout_no_progress: 5,
      late_callback: 6,
    }).indexOf(name), peerBytes),
  ]);
  return {
    contained: terminalContained(faultResult, expected),
    teardownComplete: faultResult.teardownAtMs >= faultResult.startedAtMs,
    noLateWrites: faultResult.lateWritesAfterTeardown === 0,
    peerUnaffected: peer.state === "completed" && peer.framingComplete,
  };
}

const output = arg("--output");
const keep = process.argv.includes("--keep");
const temp = await mkdtemp(join(tmpdir(), "soggfy-independent-ogg-"));

try {
  const inputA = join(temp, "fixture-a.ogg");
  const inputB = join(temp, "fixture-b.ogg");
  const outputA = join(temp, "captured-a.ogg");
  const outputB = join(temp, "captured-b.ogg");
  generateFixture(inputA, 440, 2.4);
  generateFixture(inputB, 660, 2.4);

  const bytesA = new Uint8Array(await readFile(inputA));
  const bytesB = new Uint8Array(await readFile(inputB));
  const expectedA = sha256(bytesA);
  const expectedB = sha256(bytesB);

  const parallel = await runParallelOggCaptures([
    {
      contextId: 1,
      source: new MemoryEncodedSource("local-opus-A", bytesA, {
        chunkBytes: 512,
        delayMs: 2,
      }),
      sink: new FileCaptureSink(outputA),
    },
    {
      contextId: 2,
      source: new MemoryEncodedSource("local-opus-B", bytesB, {
        chunkBytes: 640,
        delayMs: 2,
      }),
      sink: new FileCaptureSink(outputB),
    },
  ]);

  const validationA = validateAudioFile(outputA, 2400);
  const validationB = validateAudioFile(outputB, 2400);
  const c3aA = evaluateSurrogateC3a(parallel.results[0], {
    expectedSha256: expectedA,
    mediaValidationOk: validationA.ok,
  });
  const c3aB = evaluateSurrogateC3a(parallel.results[1], {
    expectedSha256: expectedB,
    mediaValidationOk: validationB.ok,
  });
  const c4 = evaluateSurrogateC4(
    parallel.results,
    parallel.overlap,
    [expectedA, expectedB],
  );

  const recoverable = {} as SurrogateC3bEvidence["recoverable"];

  recoverable.cancel_startup = await runFaultWithPeer(
    "cancel_startup",
    async () => {
      const controller = new AbortController();
      controller.abort();
      return await runIndependentOggCapture({
        contextId: 20,
        source: new MemoryEncodedSource("cancel-startup", bytesA, { chunkBytes: 512 }),
        sink: new MemoryCaptureSink(),
        signal: controller.signal,
      });
    },
    bytesB,
    "cancelled",
  );

  recoverable.cancel_consuming = await runFaultWithPeer(
    "cancel_consuming",
    async () => {
      const controller = new AbortController();
      const capture = runIndependentOggCapture({
        contextId: 21,
        source: new MemoryEncodedSource("cancel-consuming", bytesA, {
          chunkBytes: 256,
          delayMs: 4,
        }),
        sink: new MemoryCaptureSink(),
        signal: controller.signal,
      });
      await Bun.sleep(12);
      controller.abort();
      return await capture;
    },
    bytesB,
    "cancelled",
  );

  recoverable.source_read_failure = await runFaultWithPeer(
    "source_read_failure",
    async () => await runIndependentOggCapture({
      contextId: 22,
      source: new MemoryEncodedSource("source-failure", bytesA, {
        chunkBytes: 512,
        failAfterPeeks: 2,
      }),
      sink: new MemoryCaptureSink(),
    }),
    bytesB,
    "failed",
  );

  recoverable.writer_failure = await runFaultWithPeer(
    "writer_failure",
    async () => await runIndependentOggCapture({
      contextId: 23,
      source: new MemoryEncodedSource("writer-failure", bytesA, { chunkBytes: 512 }),
      sink: new MemoryCaptureSink(1),
    }),
    bytesB,
    "failed",
  );

  recoverable.timeout_no_progress = await runFaultWithPeer(
    "timeout_no_progress",
    async () => {
      const controller = new AbortController();
      const capture = runIndependentOggCapture({
        contextId: 24,
        source: new MemoryEncodedSource("timeout", bytesA, {
          chunkBytes: 512,
          delayMs: 100,
        }),
        sink: new MemoryCaptureSink(),
        signal: controller.signal,
      });
      await Bun.sleep(20);
      controller.abort();
      return await capture;
    },
    bytesB,
    "cancelled",
  );

  recoverable.late_callback = await runFaultWithPeer(
    "late_callback",
    async () => {
      const source = new MemoryEncodedSource("late-callback", bytesA, { chunkBytes: 512 });
      const sink = new MemoryCaptureSink();
      const result = await runIndependentOggCapture({
        contextId: 25,
        source,
        sink,
      });
      let rejected = 0;
      try { await source.peek(); } catch { rejected++; }
      try { await sink.write(new Uint8Array([1])); } catch { rejected++; }
      if (rejected !== 2) {
        return { ...result, state: "failed", error: "late callback was not rejected" };
      }
      return result;
    },
    bytesB,
    "completed",
  );

  const completedBeforeRestart = join(temp, "restart-completed.ogg");
  const completed = await runIndependentOggCapture({
    contextId: 30,
    source: new MemoryEncodedSource("restart-completed", bytesA, { chunkBytes: 512 }),
    sink: new FileCaptureSink(completedBeforeRestart),
  });
  const completedHashBefore = sha256(new Uint8Array(readFileSync(completedBeforeRestart)));

  const incompletePath = join(temp, "restart-incomplete.ogg");
  const restartAbort = new AbortController();
  const interruptedPromise = runIndependentOggCapture({
    contextId: 31,
    source: new MemoryEncodedSource("restart-live", bytesB, {
      chunkBytes: 256,
      delayMs: 5,
    }),
    sink: new FileCaptureSink(incompletePath),
    signal: restartAbort.signal,
  });
  await Bun.sleep(12);
  restartAbort.abort();
  const interrupted = await interruptedPromise;

  const requeuedPath = join(temp, "restart-requeued.ogg");
  const requeued = await runIndependentOggCapture({
    contextId: 32,
    source: new MemoryEncodedSource("restart-requeued", bytesB, { chunkBytes: 512 }),
    sink: new FileCaptureSink(requeuedPath),
  });

  const c3bEvidence: SurrogateC3bEvidence = {
    recoverable,
    processRestart: {
      completedArtifactsPreserved:
        completed.state === "completed" &&
        existsSync(completedBeforeRestart) &&
        completedHashBefore === expectedA,
      incompleteArtifactsUnpublished: !existsSync(incompletePath),
      liveContextsInvalidated: interrupted.state === "cancelled",
      cleanRequeueSupported:
        requeued.state === "completed" &&
        existsSync(requeuedPath) &&
        sha256(new Uint8Array(readFileSync(requeuedPath))) === expectedB,
    },
  };
  const c3b = evaluateSurrogateC3b(c3bEvidence);

  const report = {
    generatedAt: new Date().toISOString(),
    scope: "local-generated-ogg-surrogate-only",
    realSpotifyGatesChanged: false,
    fixture: {
      codec: "opus",
      durationMs: 2400,
      inputA: {
        bytes: bytesA.length,
        sha256: expectedA,
      },
      inputB: {
        bytes: bytesB.length,
        sha256: expectedB,
      },
    },
    parallel: {
      overlap: parallel.overlap,
      contexts: parallel.results.map((result) => ({
        contextId: result.contextId,
        sourceId: result.sourceId,
        state: result.state,
        totalEncodedBytes: result.totalEncodedBytes,
        sha256: result.sha256,
        pages: result.pages.length,
        progressEvents: result.progress.length,
        firstProgressAtMs: result.firstProgressAtMs,
        lastProgressAtMs: result.lastProgressAtMs,
        eosAtMs: result.eosAtMs,
        teardownAtMs: result.teardownAtMs,
        framingComplete: result.framingComplete,
        lateWritesAfterTeardown: result.lateWritesAfterTeardown,
      })),
      outputs: {
        a: {
          bytes: statSync(outputA).size,
          validation: validationA,
        },
        b: {
          bytes: statSync(outputB).size,
          validation: validationB,
        },
      },
    },
    surrogateGates: {
      C3aA: c3aA,
      C3aB: c3aB,
      C3b: c3b,
      C4: c4,
    },
    lifecycleEvidence: c3bEvidence,
    allSurrogateGatesGo: c3aA.pass && c3aB.pass && c3b.pass && c4.pass,
    note:
      "This proves the reusable local-fixture concurrency pipeline only. It does not constitute Spotify C3a/C3b/C4 evidence and does not authorize or implement protected-media extraction.",
  };

  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (output) await Bun.write(output, serialized);
  console.log(serialized);
  if (!report.allSurrogateGatesGo) process.exitCode = 1;

  if (keep) {
    console.error(`kept fixture directory: ${temp}`);
  }
} finally {
  if (!keep) await rm(temp, { recursive: true, force: true });
}
