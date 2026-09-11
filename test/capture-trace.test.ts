import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CaptureTraceInvariantError,
  CaptureTraceRecorder,
  replayCaptureTrace,
  replayCaptureTraceFile,
  type CaptureTraceEvent,
  type CaptureTraceRecord,
} from "../src/core/capture-trace";

function records(events: CaptureTraceEvent[]): CaptureTraceRecord[] {
  return events.map((event, index) => ({
    ...event,
    version: 1,
    sequence: index + 1,
    atMs: index * 100,
    trackId: "target",
  })) as CaptureTraceRecord[];
}

test("capture trace replays a successful capture deterministically", () => {
  const result = replayCaptureTrace(records([
    { type: "phase", phase: "prepare" },
    { type: "command", command: "play spotify:track:target" },
    { type: "playback", raw: JSON.stringify({ uri: "spotify:track:target", state: "playing", position: 1 }) },
    { type: "phase", phase: "capturing" },
    { type: "bytes", path: "target.ogg", bytes: 1024 },
    { type: "status", status: "downloading" },
    { type: "bytes", path: "target.ogg", bytes: 2048 },
    { type: "phase", phase: "completed" },
  ]));

  expect(result).toEqual({
    trackId: "target",
    records: 8,
    finalPhase: "completed",
    commands: 1,
    statuses: 1,
    maximumBytes: 2048,
  });
});

test("capture trace rejects another play command after confirmation", () => {
  expect(() => replayCaptureTrace(records([
    { type: "command", command: "play spotify:track:target" },
    { type: "playback", raw: JSON.stringify({ uri: "spotify:track:target", state: "playing", position: 1 }) },
    { type: "command", command: "play spotify:track:target" },
  ]))).toThrow(CaptureTraceInvariantError);
});

test("capture trace rejects decreasing captured bytes", () => {
  expect(() => replayCaptureTrace(records([
    { type: "bytes", path: "target.ogg", bytes: 2048 },
    { type: "bytes", path: "target.ogg", bytes: 1024 },
  ]))).toThrow("captured bytes decreased");
});

test("capture trace requires contiguous sequences and named timeout prerequisites", () => {
  const gap = records([{ type: "phase", phase: "prepare" }]);
  gap[0]!.sequence = 2;
  expect(() => replayCaptureTrace(gap)).toThrow("expected sequence 1, got 2");

  expect(() => replayCaptureTrace(records([
    { type: "timeout", prerequisite: "", elapsedMs: 1000 },
  ]))).toThrow("timeout has no missing prerequisite");
});

test("recorder writes replayable JSONL", () => {
  const directory = mkdtempSync(join(tmpdir(), "soggfy-trace-"));
  const recorder = new CaptureTraceRecorder("target", directory);
  recorder.record({ type: "phase", phase: "prepare" });
  recorder.record({ type: "bytes", path: "target.ogg", bytes: 4096 });
  recorder.record({ type: "phase", phase: "completed" });

  expect(readFileSync(recorder.path, "utf8").trim().split("\n")).toHaveLength(3);
  expect(replayCaptureTraceFile(recorder.path).maximumBytes).toBe(4096);
});
