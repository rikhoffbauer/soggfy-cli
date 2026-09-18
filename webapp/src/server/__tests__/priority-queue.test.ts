import { expect, test } from "bun:test";
import type { DownloadJob } from "../jobs";

async function queueModule(): Promise<any> {
  try {
    return await import("../priority-queue");
  } catch {
    return {};
  }
}

function job(id: string): DownloadJob {
  return {
    id,
    trackId: id.padEnd(22, "x").slice(0, 22),
    state: "queued",
    legacyStatus: "pending",
    createdAt: "2026-09-09T00:00:00Z",
    updatedAt: "2026-09-09T00:00:00Z",
    attempts: 0,
    bytesCaptured: 0,
    logs: [],
  };
}

function entry(id: string) {
  return {
    job: job(id),
    resolve: (_value: DownloadJob) => undefined,
    reject: (_error: Error) => undefined,
  };
}

test("promotes an existing job to the front without duplication", async () => {
  const mod = await queueModule();
  expect(typeof mod.PriorityJobQueue).toBe("function");
  if (typeof mod.PriorityJobQueue !== "function") return;

  const queue = new mod.PriorityJobQueue();
  queue.enqueue(entry("A"));
  queue.enqueue(entry("B"));
  queue.enqueue(entry("C"));
  expect(queue.promote("C")).toBe(true);
  expect(queue.ids()).toEqual(["C", "A", "B"]);
  expect(queue.enqueue(entry("C"))).toBe(false);
  expect(queue.ids()).toEqual(["C", "A", "B"]);
});

test("inserts an interrupted active job directly behind the priority head", async () => {
  const mod = await queueModule();
  expect(typeof mod.PriorityJobQueue).toBe("function");
  if (typeof mod.PriorityJobQueue !== "function") return;

  const queue = new mod.PriorityJobQueue();
  queue.enqueue(entry("C"));
  queue.enqueue(entry("normal"));
  queue.insertInterrupted(entry("A"));
  queue.insertInterrupted(entry("B"));
  expect(queue.ids()).toEqual(["C", "B", "A", "normal"]);
});

test("remove and shift return the exact queued entries", async () => {
  const mod = await queueModule();
  expect(typeof mod.PriorityJobQueue).toBe("function");
  if (typeof mod.PriorityJobQueue !== "function") return;
  const queue = new mod.PriorityJobQueue();
  const a = entry("A");
  const b = entry("B");
  queue.enqueue(a);
  queue.enqueue(b);
  expect(queue.remove("B")).toBe(b);
  expect(queue.shift()).toBe(a);
  expect(queue.ids()).toEqual([]);
});


test("snapshot exposes queue order without allowing callers to mutate the queue", async () => {
  const mod = await queueModule();
  const queue = new mod.PriorityJobQueue();
  queue.enqueue(entry("A"));
  queue.enqueue(entry("B"));
  const snapshot = queue.snapshot();
  expect(snapshot.map((item: any) => item.job.id)).toEqual(["A", "B"]);
  (snapshot as any[]).shift();
  expect(queue.ids()).toEqual(["A", "B"]);
});
