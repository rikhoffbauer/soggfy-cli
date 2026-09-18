import { createHash } from "node:crypto";
import {
  MemoryCaptureSink,
  MemoryEncodedSource,
  OggPageDecoder,
  computeOggPageCrc,
  measureProgressOverlap,
  runConcurrentOggCaptures,
  runIndependentOggCapture,
  runParallelOggCaptures,
} from "../src/dev/independent-ogg-pipeline.ts";

function writeU32LE(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function writeU64LE(target: Uint8Array, offset: number, value: bigint) {
  let current = value;
  for (let i = 0; i < 8; i++) {
    target[offset + i] = Number(current & 0xffn);
    current >>= 8n;
  }
}

function page(options: {
  serial: number;
  sequence: number;
  granule: bigint;
  type?: number;
  body: Uint8Array;
}): Uint8Array {
  if (options.body.length > 255) throw new Error("fixture body too large");
  const bytes = new Uint8Array(28 + options.body.length);
  bytes.set([0x4f, 0x67, 0x67, 0x53, 0, options.type ?? 0], 0);
  writeU64LE(bytes, 6, options.granule);
  writeU32LE(bytes, 14, options.serial);
  writeU32LE(bytes, 18, options.sequence);
  bytes[26] = 1;
  bytes[27] = options.body.length;
  bytes.set(options.body, 28);
  writeU32LE(bytes, 22, computeOggPageCrc(bytes));
  return bytes;
}

function concat(...chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function fixture(serial = 0x12345678): Uint8Array {
  return concat(
    page({
      serial,
      sequence: 0,
      granule: 0n,
      type: 0x02,
      body: new TextEncoder().encode("vorbis-header"),
    }),
    page({
      serial,
      sequence: 1,
      granule: 1024n,
      body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    }),
    page({
      serial,
      sequence: 2,
      granule: 2048n,
      type: 0x04,
      body: new Uint8Array([9, 10, 11, 12]),
    }),
  );
}

describe("independent Ogg pipeline", () => {
  test("page decoder handles arbitrary source chunking", () => {
    const bytes = fixture();
    const decoder = new OggPageDecoder();
    for (let offset = 0; offset < bytes.length; offset += 7) {
      decoder.push(bytes.slice(offset, offset + 7));
    }
    const result = decoder.finish();
    expect(result.complete).toBe(true);
    expect(result.pages.map((item) => item.sequence)).toEqual([0, 1, 2]);
    expect(result.pages[0]?.bos).toBe(true);
    expect(result.pages[2]?.eos).toBe(true);
  });

  test("one context captures an exact independently consumed artifact", async () => {
    const bytes = fixture();
    const sink = new MemoryCaptureSink();
    const result = await runIndependentOggCapture({
      contextId: 11,
      source: new MemoryEncodedSource("fixture-A", bytes, { chunkBytes: 9 }),
      sink,
    });

    expect(result.state).toBe("completed");
    expect(result.framingComplete).toBe(true);
    expect(result.pages).toHaveLength(3);
    expect(result.totalEncodedBytes).toBe(bytes.length);
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(sink.bytes()).toEqual(bytes);
    expect(result.lateWritesAfterTeardown).toBe(0);
    expect(result.stateHistory.map((item) => item.state)).toEqual([
      "resolving",
      "ready",
      "consuming",
      "draining",
      "completed",
    ]);
  });

  test("two contexts own separate source/decoder/capture state and make overlapping progress", async () => {
    const a = fixture(0x11111111);
    const b = fixture(0x22222222);
    const sinkA = new MemoryCaptureSink();
    const sinkB = new MemoryCaptureSink();

    const { results, overlap } = await runParallelOggCaptures([
      {
        contextId: 1,
        source: new MemoryEncodedSource("A", a, { chunkBytes: 5, delayMs: 2 }),
        sink: sinkA,
      },
      {
        contextId: 2,
        source: new MemoryEncodedSource("B", b, { chunkBytes: 6, delayMs: 2 }),
        sink: sinkB,
      },
    ]);

    expect(results[0].state).toBe("completed");
    expect(results[1].state).toBe("completed");
    expect(results[0].sha256).toBe(createHash("sha256").update(a).digest("hex"));
    expect(results[1].sha256).toBe(createHash("sha256").update(b).digest("hex"));
    expect(sinkA.bytes()).toEqual(a);
    expect(sinkB.bytes()).toEqual(b);
    expect(overlap.bothMadeProgress).toBe(true);
    expect(overlap.overlapMs).toBeGreaterThanOrEqual(0);
  });

  test("N-worker coordinator supports three independent capture contexts", async () => {
    const fixtures = [
      fixture(0x33333331),
      fixture(0x33333332),
      fixture(0x33333333),
    ];
    const run = await runConcurrentOggCaptures(fixtures.map((bytes, index) => ({
      contextId: 40 + index,
      source: new MemoryEncodedSource(`multi-${index}`, bytes, {
        chunkBytes: 4 + index,
        delayMs: 2,
      }),
      sink: new MemoryCaptureSink(),
    })));

    expect(run.results).toHaveLength(3);
    expect(run.results.every((result) => result.state === "completed")).toBe(true);
    expect(run.pairwiseOverlaps).toHaveLength(3);
    expect(run.pairwiseOverlaps.every((overlap) => overlap.bothMadeProgress)).toBe(true);
    expect(run.overlap.contextIds).toEqual([40, 41, 42]);
    expect(run.overlap.allMadeProgress).toBe(true);
    expect(run.overlap.overlapMs).toBeGreaterThanOrEqual(0);
  });

  test("measureProgressOverlap rejects disjoint timelines", () => {
    const base = {
      sourceId: "x",
      state: "completed" as const,
      stateHistory: [],
      eosAtMs: 20,
      teardownAtMs: 21,
      totalEncodedBytes: 1,
      sha256: "a".repeat(64),
      framingComplete: true,
      pages: [],
      progress: [],
      lateWritesAfterTeardown: 0,
    };
    const overlap = measureProgressOverlap(
      { ...base, contextId: 1, startedAtMs: 0, firstProgressAtMs: 1, lastProgressAtMs: 5 },
      { ...base, contextId: 2, startedAtMs: 6, firstProgressAtMs: 7, lastProgressAtMs: 10 },
    );
    expect(overlap.bothMadeProgress).toBe(false);
    expect(overlap.overlapMs).toBe(0);
  });

  test("source failure is contained and tears down without publishing completion", async () => {
    const result = await runIndependentOggCapture({
      contextId: 3,
      source: new MemoryEncodedSource("bad-source", fixture(), {
        chunkBytes: 8,
        failAfterPeeks: 2,
      }),
      sink: new MemoryCaptureSink(),
    });

    expect(result.state).toBe("failed");
    expect(result.error).toContain("synthetic source read failure");
    expect(result.stateHistory.at(-1)?.state).toBe("failed");
    expect(result.lateWritesAfterTeardown).toBe(0);
  });

  test("writer failure is contained", async () => {
    const result = await runIndependentOggCapture({
      contextId: 4,
      source: new MemoryEncodedSource("writer-failure", fixture(), { chunkBytes: 8 }),
      sink: new MemoryCaptureSink(1),
    });

    expect(result.state).toBe("failed");
    expect(result.error).toContain("synthetic sink failure");
    expect(result.lateWritesAfterTeardown).toBe(0);
  });

  test("abort produces a bounded cancelled terminal state", async () => {
    const controller = new AbortController();
    const source = new MemoryEncodedSource("cancelled", fixture(), {
      chunkBytes: 4,
      delayMs: 3,
    });
    const promise = runIndependentOggCapture({
      contextId: 5,
      source,
      sink: new MemoryCaptureSink(),
      signal: controller.signal,
    });
    await Bun.sleep(5);
    controller.abort();
    const result = await promise;

    expect(result.state).toBe("cancelled");
    expect(result.error).toContain("capture cancelled");
    expect(result.lateWritesAfterTeardown).toBe(0);
  });

  test("CRC corruption fails closed even when Ogg framing still looks valid", async () => {
    const bytes = fixture();
    bytes[35] ^= 0x01;
    const result = await runIndependentOggCapture({
      contextId: 7,
      source: new MemoryEncodedSource("bad-crc", bytes, { chunkBytes: 11 }),
      sink: new MemoryCaptureSink(),
    });

    expect(result.state).toBe("failed");
    expect(result.error).toContain("incomplete Ogg framing");
    expect(result.framingComplete).toBe(false);
  });

  test("framing corruption fails closed", async () => {
    const bytes = fixture();
    bytes[0] = 0;
    const result = await runIndependentOggCapture({
      contextId: 6,
      source: new MemoryEncodedSource("corrupt", bytes, { chunkBytes: 9 }),
      sink: new MemoryCaptureSink(),
    });

    expect(result.state).toBe("failed");
    expect(result.error).toContain("incomplete Ogg framing");
    expect(result.framingComplete).toBe(false);
  });
});
