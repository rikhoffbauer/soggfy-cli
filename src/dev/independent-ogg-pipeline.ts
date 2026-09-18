import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";

export type IndependentCaptureState =
  | "resolving"
  | "ready"
  | "consuming"
  | "draining"
  | "completed"
  | "cancelled"
  | "failed";

export interface EncodedSourceSpan {
  data: Uint8Array;
  eof: boolean;
}

export interface IndependentEncodedSource {
  readonly id: string;
  peek(): Promise<EncodedSourceSpan>;
  consume(amount: number): Promise<void>;
  teardown(): Promise<void>;
}

export interface IndependentCaptureSink {
  write(chunk: Uint8Array): Promise<void>;
  finalize(): Promise<void>;
  abort(): Promise<void>;
}

export interface OggPageObservation {
  serial: number;
  sequence: number;
  granulePosition: bigint;
  headerType: number;
  bytes: number;
  bos: boolean;
  eos: boolean;
}

export interface IndependentCaptureProgress {
  contextId: number;
  sourceId: string;
  atMs: number;
  totalEncodedBytes: number;
  pageSequence?: number;
  granulePosition?: number;
}

export interface IndependentCaptureResult {
  contextId: number;
  sourceId: string;
  state: IndependentCaptureState;
  stateHistory: Array<{ state: IndependentCaptureState; atMs: number }>;
  startedAtMs: number;
  firstProgressAtMs: number | null;
  lastProgressAtMs: number | null;
  eosAtMs: number | null;
  teardownAtMs: number;
  totalEncodedBytes: number;
  sha256: string;
  framingComplete: boolean;
  pages: OggPageObservation[];
  progress: IndependentCaptureProgress[];
  lateWritesAfterTeardown: number;
  error?: string;
}

export interface IndependentCaptureOptions {
  contextId: number;
  source: IndependentEncodedSource;
  sink: IndependentCaptureSink;
  signal?: AbortSignal;
  now?: () => number;
  onProgress?: (event: IndependentCaptureProgress) => void;
}

function concatBytes(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  if (a.length === 0) return b.slice();
  if (b.length === 0) return a.slice();
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function uint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function uint64LE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(bytes[offset + i]!);
  return value;
}

const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = (i << 24) >>> 0;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 0x80000000)
        ? (((value << 1) ^ 0x04c11db7) >>> 0)
        : ((value << 1) >>> 0);
    }
    table[i] = value;
  }
  return table;
})();

export function computeOggPageCrc(page: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < page.length; i++) {
    const byte = i >= 22 && i < 26 ? 0 : page[i]!;
    const index = ((crc >>> 24) ^ byte) & 0xff;
    crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[index]!) >>> 0;
  }
  return crc >>> 0;
}

export class OggPageDecoder {
  private buffered: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private observations: OggPageObservation[] = [];
  private serial: number | null = null;
  private nextSequence: number | null = null;
  private sawBos = false;
  private sawEos = false;
  private invalid = false;

  push(chunk: Uint8Array): OggPageObservation[] {
    if (chunk.length === 0) return [];
    this.buffered = concatBytes(this.buffered, chunk);
    const parsed: OggPageObservation[] = [];

    while (this.buffered.length >= 27) {
      if (
        this.buffered[0] !== 0x4f ||
        this.buffered[1] !== 0x67 ||
        this.buffered[2] !== 0x67 ||
        this.buffered[3] !== 0x53 ||
        this.buffered[4] !== 0
      ) {
        this.invalid = true;
        break;
      }

      const segmentCount = this.buffered[26]!;
      const headerBytes = 27 + segmentCount;
      if (this.buffered.length < headerBytes) break;

      let bodyBytes = 0;
      for (let i = 0; i < segmentCount; i++) bodyBytes += this.buffered[27 + i]!;
      const pageBytes = headerBytes + bodyBytes;
      if (this.buffered.length < pageBytes) break;

      const page = this.buffered.subarray(0, pageBytes);
      const storedCrc = uint32LE(page, 22);
      if (storedCrc !== computeOggPageCrc(page)) this.invalid = true;

      const headerType = this.buffered[5]!;
      const serial = uint32LE(this.buffered, 14);
      const sequence = uint32LE(this.buffered, 18);
      const granulePosition = uint64LE(this.buffered, 6);
      const bos = (headerType & 0x02) !== 0;
      const eos = (headerType & 0x04) !== 0;

      if (this.serial === null) {
        this.serial = serial;
        this.nextSequence = sequence;
      }
      if (serial !== this.serial) this.invalid = true;
      if (this.nextSequence !== null && sequence !== this.nextSequence) this.invalid = true;
      this.nextSequence = (sequence + 1) >>> 0;
      if (bos) {
        if (this.observations.length !== 0 || this.sawBos) this.invalid = true;
        this.sawBos = true;
      }
      if (eos) this.sawEos = true;

      const observation: OggPageObservation = {
        serial,
        sequence,
        granulePosition,
        headerType,
        bytes: pageBytes,
        bos,
        eos,
      };
      this.observations.push(observation);
      parsed.push(observation);
      this.buffered = this.buffered.slice(pageBytes);
    }

    return parsed;
  }

  finish(): { complete: boolean; pages: OggPageObservation[] } {
    return {
      complete:
        !this.invalid &&
        this.buffered.length === 0 &&
        this.observations.length > 0 &&
        this.sawBos &&
        this.sawEos,
      pages: [...this.observations],
    };
  }
}

export class MemoryEncodedSource implements IndependentEncodedSource {
  private offset = 0;
  private closed = false;
  private current?: Uint8Array;
  private peekCount = 0;

  constructor(
    public readonly id: string,
    private readonly bytes: Uint8Array,
    private readonly options: {
      chunkBytes?: number;
      delayMs?: number;
      failAfterPeeks?: number;
    } = {},
  ) {}

  async peek(): Promise<EncodedSourceSpan> {
    if (this.closed) throw new Error("source is torn down");
    this.peekCount++;
    if (
      this.options.failAfterPeeks !== undefined &&
      this.peekCount > this.options.failAfterPeeks
    ) {
      throw new Error("synthetic source read failure");
    }
    if (this.options.delayMs) await Bun.sleep(this.options.delayMs);
    if (this.current) return { data: this.current, eof: false };
    if (this.offset >= this.bytes.length) return { data: new Uint8Array(), eof: true };

    const chunkBytes = Math.max(1, this.options.chunkBytes ?? 4096);
    this.current = this.bytes.slice(this.offset, Math.min(this.bytes.length, this.offset + chunkBytes));
    return { data: this.current, eof: false };
  }

  async consume(amount: number): Promise<void> {
    if (this.closed) throw new Error("source is torn down");
    if (!this.current) {
      if (amount === 0) return;
      throw new Error("consume without active span");
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > this.current.length) {
      throw new Error("invalid consume amount");
    }
    this.offset += amount;
    this.current = amount === this.current.length ? undefined : this.current.slice(amount);
  }

  async teardown(): Promise<void> {
    this.closed = true;
    this.current = undefined;
  }
}

export class MemoryCaptureSink implements IndependentCaptureSink {
  private chunks: Uint8Array[] = [];
  private closed = false;
  private writes = 0;

  constructor(private readonly failAfterWrites?: number) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("sink is closed");
    this.writes++;
    if (this.failAfterWrites !== undefined && this.writes > this.failAfterWrites) {
      throw new Error("synthetic sink failure");
    }
    this.chunks.push(chunk.slice());
  }

  async finalize(): Promise<void> {
    this.closed = true;
  }

  async abort(): Promise<void> {
    this.closed = true;
    this.chunks = [];
  }

  bytes(): Uint8Array {
    let total = 0;
    for (const chunk of this.chunks) total += chunk.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

export class FileCaptureSink implements IndependentCaptureSink {
  private handle?: Awaited<ReturnType<typeof open>>;
  private closed = false;

  constructor(public readonly path: string) {}

  private async file() {
    if (!this.handle) this.handle = await open(this.path, "w");
    return this.handle;
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("sink is closed");
    await (await this.file()).write(chunk);
  }

  async finalize(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.handle) {
      await this.handle.sync();
      await this.handle.close();
      this.handle = undefined;
    }
  }

  async abort(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      if (this.handle) {
        await this.handle.close().catch(() => {});
        this.handle = undefined;
      }
    }
    await unlink(this.path).catch(() => {});
  }
}

function abortError(): Error {
  const error = new Error("capture cancelled");
  error.name = "AbortError";
  return error;
}

export async function runIndependentOggCapture(
  options: IndependentCaptureOptions,
): Promise<IndependentCaptureResult> {
  const now = options.now ?? Date.now;
  const startedAtMs = now();
  const decoder = new OggPageDecoder();
  const hash = createHash("sha256");
  const progress: IndependentCaptureProgress[] = [];
  const stateHistory: Array<{ state: IndependentCaptureState; atMs: number }> = [];
  let state: IndependentCaptureState = "resolving";
  let totalEncodedBytes = 0;
  let eosAtMs: number | null = null;
  let teardownAtMs = startedAtMs;
  let lateWritesAfterTeardown = 0;
  let finalized = false;
  let tornDown = false;

  const transition = (next: IndependentCaptureState) => {
    state = next;
    stateHistory.push({ state: next, atMs: now() });
  };

  const assertNotAborted = () => {
    if (options.signal?.aborted) throw abortError();
  };

  transition("resolving");
  try {
    assertNotAborted();
    transition("ready");
    transition("consuming");

    for (;;) {
      assertNotAborted();
      const span = await options.source.peek();
      if (span.data.length === 0) {
        if (!span.eof) throw new Error("source returned an empty non-EOF span");
        break;
      }

      if (tornDown) lateWritesAfterTeardown++;
      await options.sink.write(span.data);
      hash.update(span.data);
      totalEncodedBytes += span.data.length;
      const pages = decoder.push(span.data);

      const lastPage = pages.at(-1);
      if (lastPage?.eos) eosAtMs = now();
      const event: IndependentCaptureProgress = {
        contextId: options.contextId,
        sourceId: options.source.id,
        atMs: now(),
        totalEncodedBytes,
        pageSequence: lastPage?.sequence,
        granulePosition: lastPage ? Number(lastPage.granulePosition) : undefined,
      };
      progress.push(event);
      options.onProgress?.(event);

      await options.source.consume(span.data.length);
    }

    transition("draining");
    const framing = decoder.finish();
    if (!framing.complete) throw new Error("incomplete Ogg framing");
    if (eosAtMs === null) eosAtMs = now();
    await options.sink.finalize();
    finalized = true;
    transition("completed");

    await options.source.teardown();
    tornDown = true;
    teardownAtMs = now();

    return {
      contextId: options.contextId,
      sourceId: options.source.id,
      state,
      stateHistory,
      startedAtMs,
      firstProgressAtMs: progress[0]?.atMs ?? null,
      lastProgressAtMs: progress.at(-1)?.atMs ?? null,
      eosAtMs,
      teardownAtMs,
      totalEncodedBytes,
      sha256: hash.digest("hex"),
      framingComplete: true,
      pages: framing.pages,
      progress,
      lateWritesAfterTeardown,
    };
  } catch (error) {
    const cancelled = error instanceof Error && error.name === "AbortError";
    transition(cancelled ? "cancelled" : "failed");
    if (!finalized) await options.sink.abort().catch(() => {});
    await options.source.teardown().catch(() => {});
    tornDown = true;
    teardownAtMs = now();
    const framing = decoder.finish();
    return {
      contextId: options.contextId,
      sourceId: options.source.id,
      state,
      stateHistory,
      startedAtMs,
      firstProgressAtMs: progress[0]?.atMs ?? null,
      lastProgressAtMs: progress.at(-1)?.atMs ?? null,
      eosAtMs,
      teardownAtMs,
      totalEncodedBytes,
      sha256: hash.digest("hex"),
      framingComplete: framing.complete,
      pages: framing.pages,
      progress,
      lateWritesAfterTeardown,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ParallelCaptureOverlap {
  contextIds: [number, number];
  overlapStartMs: number;
  overlapEndMs: number;
  overlapMs: number;
  bothMadeProgress: boolean;
}

export function measureProgressOverlap(
  a: IndependentCaptureResult,
  b: IndependentCaptureResult,
): ParallelCaptureOverlap {
  const aStart = a.firstProgressAtMs ?? Number.POSITIVE_INFINITY;
  const bStart = b.firstProgressAtMs ?? Number.POSITIVE_INFINITY;
  const aEnd = a.lastProgressAtMs ?? Number.NEGATIVE_INFINITY;
  const bEnd = b.lastProgressAtMs ?? Number.NEGATIVE_INFINITY;
  const overlapStartMs = Math.max(aStart, bStart);
  const overlapEndMs = Math.min(aEnd, bEnd);
  const overlapMs = Math.max(0, overlapEndMs - overlapStartMs);
  return {
    contextIds: [a.contextId, b.contextId],
    overlapStartMs,
    overlapEndMs,
    overlapMs,
    bothMadeProgress:
      Number.isFinite(overlapStartMs) &&
      Number.isFinite(overlapEndMs) &&
      overlapEndMs >= overlapStartMs &&
      a.progress.length > 0 &&
      b.progress.length > 0,
  };
}

export interface ConcurrentCaptureOverlap {
  contextIds: number[];
  overlapStartMs: number;
  overlapEndMs: number;
  overlapMs: number;
  allMadeProgress: boolean;
}

export function measureConcurrentProgressOverlap(
  results: readonly IndependentCaptureResult[],
): ConcurrentCaptureOverlap {
  if (results.length === 0) {
    return {
      contextIds: [],
      overlapStartMs: Number.POSITIVE_INFINITY,
      overlapEndMs: Number.NEGATIVE_INFINITY,
      overlapMs: 0,
      allMadeProgress: false,
    };
  }

  const overlapStartMs = Math.max(
    ...results.map((result) => result.firstProgressAtMs ?? Number.POSITIVE_INFINITY),
  );
  const overlapEndMs = Math.min(
    ...results.map((result) => result.lastProgressAtMs ?? Number.NEGATIVE_INFINITY),
  );
  const overlapMs = Math.max(0, overlapEndMs - overlapStartMs);
  const allMadeProgress =
    results.every((result) => result.progress.length > 0) &&
    Number.isFinite(overlapStartMs) &&
    Number.isFinite(overlapEndMs) &&
    overlapEndMs >= overlapStartMs;

  return {
    contextIds: results.map((result) => result.contextId),
    overlapStartMs,
    overlapEndMs,
    overlapMs,
    allMadeProgress,
  };
}

export async function runConcurrentOggCaptures(
  options: readonly IndependentCaptureOptions[],
): Promise<{
  results: IndependentCaptureResult[];
  overlap: ConcurrentCaptureOverlap;
  pairwiseOverlaps: ParallelCaptureOverlap[];
}> {
  if (options.length === 0) throw new Error("at least one independent capture is required");
  const results = await Promise.all(options.map((item) => runIndependentOggCapture(item)));
  const pairwiseOverlaps: ParallelCaptureOverlap[] = [];
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      pairwiseOverlaps.push(measureProgressOverlap(results[i]!, results[j]!));
    }
  }
  return {
    results,
    overlap: measureConcurrentProgressOverlap(results),
    pairwiseOverlaps,
  };
}

export async function runParallelOggCaptures(
  options: [IndependentCaptureOptions, IndependentCaptureOptions],
): Promise<{
  results: [IndependentCaptureResult, IndependentCaptureResult];
  overlap: ParallelCaptureOverlap;
}> {
  const concurrent = await runConcurrentOggCaptures(options);
  const results = concurrent.results as [IndependentCaptureResult, IndependentCaptureResult];
  return { results, overlap: measureProgressOverlap(results[0], results[1]) };
}
