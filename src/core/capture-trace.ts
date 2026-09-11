import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { LOG_DIR } from "./paths";

export type CapturePhase =
  | "prepare"
  | "awaiting_playback"
  | "awaiting_capture"
  | "capturing"
  | "finalizing"
  | "completed"
  | "failed";

export type CaptureTraceEvent =
  | { type: "phase"; phase: CapturePhase }
  | { type: "command"; command: string }
  | { type: "response"; command: string; response: string }
  | { type: "playback"; raw: string }
  | { type: "status"; status: string }
  | { type: "bytes"; path: string; bytes: number }
  | { type: "timeout"; prerequisite: string; elapsedMs: number }
  | { type: "error"; message: string };

export type CaptureTraceRecord = CaptureTraceEvent & {
  version: 1;
  sequence: number;
  atMs: number;
  trackId: string;
};
export interface CaptureTraceSummary {
  trackId: string;
  records: number;
  finalPhase: CapturePhase;
  commands: number;
  statuses: number;
  maximumBytes: number;
}

export class CaptureTraceInvariantError extends Error {
  constructor(
    message: string,
    readonly sequence: number,
  ) {
    super(`Trace invariant failed at event ${sequence}: ${message}`);
    this.name = "CaptureTraceInvariantError";
  }
}

export class CaptureTraceState {
  phase: CapturePhase = "prepare";
  confirmed = false;
  maximumBytes = 0;
  commands = 0;
  statuses = 0;

  apply(record: CaptureTraceRecord): void {
    if (record.type === "phase") this.applyPhase(record);
    if (record.type === "command") this.applyCommand(record);
    if (record.type === "playback") this.applyPlayback(record);
    if (record.type === "status") this.applyStatus(record);
    if (record.type === "bytes") this.applyBytes(record);
    if (record.type === "timeout" && !record.prerequisite.trim()) {
      throw new CaptureTraceInvariantError("timeout has no missing prerequisite", record.sequence);
    }
  }
  private applyPhase(record: CaptureTraceRecord & { type: "phase" }): void {
    const terminal = this.phase === "completed" || this.phase === "failed";
    if (terminal && record.phase !== this.phase) {
      throw new CaptureTraceInvariantError(
        `transition after terminal phase ${this.phase}`,
        record.sequence,
      );
    }
    this.phase = record.phase;
  }

  private applyCommand(record: CaptureTraceRecord & { type: "command" }): void {
    this.commands++;
    if (this.confirmed && record.command.startsWith("play ")) {
      throw new CaptureTraceInvariantError(
        "play command repeated after target confirmation",
        record.sequence,
      );
    }
  }

  private applyPlayback(record: CaptureTraceRecord & { type: "playback" }): void {
    try {
      const value = JSON.parse(record.raw) as {
        uri?: unknown;
        state?: unknown;
        position?: unknown;
      };
      this.confirmed ||= value.uri === `spotify:track:${record.trackId}`
        && value.state === "playing"
        && typeof value.position === "number"
        && value.position > 0.1;
    } catch {
      // Malformed snapshots are recorded evidence, not replay failures.
    }
  }
  private applyStatus(_record: CaptureTraceRecord & { type: "status" }): void {
    this.statuses++;
  }

  private applyBytes(record: CaptureTraceRecord & { type: "bytes" }): void {
    if (record.bytes < this.maximumBytes) {
      throw new CaptureTraceInvariantError(
        `captured bytes decreased from ${this.maximumBytes} to ${record.bytes}`,
        record.sequence,
      );
    }
    this.maximumBytes = record.bytes;
  }
}

export function parseCaptureTrace(text: string): CaptureTraceRecord[] {
  const records: CaptureTraceRecord[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL at line ${index + 1}`);
    }
    if (!value || typeof value !== "object") {
      throw new Error(`Invalid trace record at line ${index + 1}`);
    }
    const record = value as CaptureTraceRecord;
    if (record.version !== 1 || typeof record.sequence !== "number"
      || typeof record.trackId !== "string" || typeof record.type !== "string") {
      throw new Error(`Invalid trace schema at line ${index + 1}`);
    }
    records.push(record);
  }
  return records;
}
export function replayCaptureTrace(records: CaptureTraceRecord[]): CaptureTraceSummary {
  if (records.length === 0) throw new Error("Capture trace is empty");
  const trackId = records[0]!.trackId;
  const state = new CaptureTraceState();
  let expectedSequence = 1;

  for (const record of records) {
    if (record.trackId !== trackId) {
      throw new CaptureTraceInvariantError("trace contains multiple track IDs", record.sequence);
    }
    if (record.sequence !== expectedSequence) {
      throw new CaptureTraceInvariantError(
        `expected sequence ${expectedSequence}, got ${record.sequence}`,
        record.sequence,
      );
    }
    state.apply(record);
    expectedSequence++;
  }

  return {
    trackId,
    records: records.length,
    finalPhase: state.phase,
    commands: state.commands,
    statuses: state.statuses,
    maximumBytes: state.maximumBytes,
  };
}

export function replayCaptureTraceFile(path: string): CaptureTraceSummary {
  return replayCaptureTrace(parseCaptureTrace(readFileSync(path, "utf8")));
}
export class CaptureTraceRecorder {
  readonly path: string;
  private sequence = 0;
  private readonly startedAt = Date.now();
  private readonly state = new CaptureTraceState();

  constructor(
    readonly trackId: string,
    traceDir = process.env.SOGGFY_TRACE_DIR?.trim() || join(LOG_DIR, "captures"),
  ) {
    mkdirSync(traceDir, { recursive: true, mode: 0o700 });
    const stamp = new Date(this.startedAt).toISOString().replace(/[:.]/g, "-");
    this.path = join(traceDir, `${stamp}-${safeName(trackId)}-${process.pid}.jsonl`);
  }

  record(event: CaptureTraceEvent): void {
    const record = {
      version: 1 as const,
      sequence: ++this.sequence,
      atMs: Date.now() - this.startedAt,
      trackId: this.trackId,
      ...event,
    } as CaptureTraceRecord;
    this.state.apply(record);
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  command(command: string): void {
    this.record({ type: "command", command });
  }

  response(command: string, response: string): void {
    this.record({ type: "response", command, response });
  }
}

function safeName(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80) || "unknown";
}
