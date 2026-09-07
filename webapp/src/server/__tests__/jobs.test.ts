import { expect, test } from "bun:test";
import { JobRegistry } from "../jobs";

const trackId = "4PTG3Z6ehGkBFwjybzWkR8";

test("job registry creates explicit state transitions and legacy statuses", () => {
  const registry = new JobRegistry();
  const job = registry.create(trackId);
  expect(job.state).toBe("queued");
  expect(job.legacyStatus).toBe("pending");

  registry.transition(job, "capturing", { bytesCaptured: 1024 });
  expect(job.legacyStatus).toBe("downloading");
  expect(registry.toLegacyStatus()[job.trackId].bytesCaptured).toBe(1024);

  registry.complete(job, { outputFormat: "mp3", sizeBytes: 42 });
  expect(job.legacyStatus).toBe("completed");
});

test("failed and cancelled jobs are terminal and do not block replacement jobs", () => {
  const registry = new JobRegistry();
  const failed = registry.create(trackId);
  registry.fail(failed, new Error("boom"));

  expect(registry.isTerminal(failed)).toBe(true);
  expect(registry.findReusable(trackId)).toBeUndefined();

  const replacement = registry.create(trackId);
  expect(replacement.id).not.toBe(failed.id);
  expect(registry.findReusable(trackId)?.id).toBe(replacement.id);

  registry.cancel(replacement, "not now");
  expect(replacement.state).toBe("cancelled");
  expect(replacement.legacyStatus).toBe("failed");
  expect(registry.findReusable(trackId)).toBeUndefined();
});
