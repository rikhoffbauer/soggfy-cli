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

test("priority interruption requeues the same job without spending an attempt", () => {
  const registry = new JobRegistry();
  const job = registry.create(trackId);
  registry.transition(job, "capturing", {
    attempts: 2,
    bytesCaptured: 4096,
    capturePath: "/tmp/partial.ogg",
    oggPath: "/tmp/partial.ogg",
    instanceId: 1,
    error: "stale",
    priorityInterrupted: true,
  });

  registry.requeueAfterPriorityInterruption(job);

  expect(job.state).toBe("queued");
  expect(job.legacyStatus).toBe("pending");
  expect(job.attempts).toBe(1);
  expect(job.bytesCaptured).toBe(0);
  expect(job.capturePath).toBeUndefined();
  expect(job.oggPath).toBeUndefined();
  expect(job.instanceId).toBeUndefined();
  expect(job.error).toBeUndefined();
  expect(job.priorityInterrupted).toBeUndefined();
});

import { afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const historyRoots: string[] = [];
afterEach(() => historyRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("job registry hydrates completed downloads from sidecars", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-job-history-"));
  historyRoots.push(root);
  const audio = join(root, `${trackId}.mp3`);
  writeFileSync(audio, "audio");
  writeFileSync(`${audio}.json`, JSON.stringify({
    jobId: "persisted-job",
    trackId,
    state: "completed",
    outputFormat: "mp3",
    savedPath: audio,
    sizeBytes: 5,
    completedAt: "2026-09-10T08:00:00.000Z",
    metadata: { title: "Persisted", artist: "Artist" },
  }));
  const registry = new JobRegistry();
  registry.hydrateFromOutputDir(root);
  expect(registry.findByTrack(trackId)).toMatchObject({
    id: "persisted-job",
    state: "completed",
    savedPath: audio,
  });
});

test("job registry bounds terminal history while retaining active work", () => {
  const registry = new JobRegistry({ maxTerminalJobs: 2 });
  const active = registry.create("1111111111111111111111");
  for (const id of [
    "2222222222222222222222",
    "3333333333333333333333",
    "4444444444444444444444",
  ]) {
    const job = registry.create(id);
    registry.complete(job, { savedPath: `/tmp/${id}.mp3`, outputFormat: "mp3" });
  }
  const jobs = registry.all();
  expect(jobs.some((job) => job.id === active.id)).toBe(true);
  expect(jobs.filter((job) => job.state === "completed")).toHaveLength(2);
});

test("job registry revision increases whenever client-visible state changes", () => {
  const registry = new JobRegistry();
  const initial = registry.revision;
  const job = registry.create(trackId);
  const created = registry.revision;
  registry.patch(job, { bytesCaptured: 10 });
  const patched = registry.revision;
  registry.complete(job);
  expect(created).toBeGreaterThan(initial);
  expect(patched).toBeGreaterThan(created);
  expect(registry.revision).toBeGreaterThan(patched);
});
test("non-finite terminal history limits fall back to 500", () => {
  const registry = new JobRegistry({ maxTerminalJobs: Number.NaN });
  for (let index = 0; index < 501; index++) {
    const job = registry.create(`track-${index}`);
    registry.fail(job, "done");
  }
  expect(registry.all()).toHaveLength(500);
});
