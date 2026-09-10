import { expect, test } from "bun:test";
import { captureMaxWaitMs, captureMonitorDecision, PlaybackProgressMonitor } from "../src/core/capture-monitor";

test("capture monitor never treats unchanged byte progress as completion", () => {
  const maxWait = captureMaxWaitMs(224_200);
  expect(captureMonitorDecision("downloading", 21_000, maxWait)).toBe("continue");
  expect(captureMonitorDecision("downloading", 120_000, maxWait)).toBe("continue");
  expect(captureMonitorDecision("completed", 1_000, maxWait)).toBe("completed");
  expect(captureMonitorDecision("downloading", maxWait, maxWait)).toBe("deadline");
});

test("playback monitor fails a paused or frozen player without finalizing bytes", () => {
  const monitor = new PlaybackProgressMonitor("track", 0);
  const snapshot = (position: number, state = "playing") => JSON.stringify({ uri: "spotify:track:track", state, position });
  monitor.observe(snapshot(1), 1_000);
  monitor.observe(snapshot(25), 25_000);
  monitor.observe(snapshot(25), 50_000);
  expect(() => monitor.observe(snapshot(25), 56_000)).toThrow("not advanced");
  expect(() => new PlaybackProgressMonitor("track", 0).observe(snapshot(0, "paused"), 31_000)).toThrow("paused");
});

test("playback monitor rejects stale target position and invalid telemetry", () => {
  const monitor = new PlaybackProgressMonitor("target", 0);
  expect(() => monitor.observe(JSON.stringify({ uri: "spotify:track:other", state: "playing", position: 99 }), 31_000)).toThrow("target");
  expect(() => monitor.observe("{}", 31_000)).toThrow("unavailable");
});
