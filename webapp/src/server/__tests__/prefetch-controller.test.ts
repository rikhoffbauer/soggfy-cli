import { expect, test } from "bun:test";
import type { PlaybackConfirmation } from "../../../../src/core/capture-control";
import type { PrefetchPolicy, PrefetchResult, PrefetchVariant } from "../../../../src/core/spotify-prefetch";
import { DEFAULT_PREFETCH_LOOKAHEAD, QueuePrefetchController, type PrefetchAdapterPort } from "../prefetch-controller";
import type { DownloadJob } from "../jobs";
import { jobs } from "../runtime-state";

function track(seed: string): string {
  return (seed + "x".repeat(22)).slice(0, 22);
}

function entry(job: DownloadJob) {
  return { job, resolve: (_job: DownloadJob) => undefined, reject: (_error: Error) => undefined };
}

class FakeAdapter implements PrefetchAdapterPort {
  policy: PrefetchPolicy = { formatEnum: 1, bitrate: 160_000 };
  resolved: string[] = [];
  prefetched: PrefetchVariant[] = [];
  aborted: string[] = [];
  closed = 0;
  block = false;
  cleanupUncertainOnAbort = false;

  async derivePolicy(): Promise<PrefetchPolicy | null> {
    return this.policy;
  }

  async currentSelection(trackUri: string) {
    return {
      trackUri,
      fileId: "f".repeat(40),
      fileBitrate: this.policy.bitrate,
      policy: this.policy,
    };
  }

  async resolveVariant(trackUri: string): Promise<PrefetchVariant | null> {
    this.resolved.push(trackUri);
    const id = trackUri.split(":").at(-1)!;
    return { trackUri, fileId: id.padEnd(40, "a").slice(0, 40), formatEnum: 1, bitrate: 160_000 };
  }

  async prefetch(variant: PrefetchVariant, { signal }: { signal?: AbortSignal } = {}): Promise<PrefetchResult> {
    this.prefetched.push(variant);
    if (this.block) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          this.aborted.push(variant.trackUri);
          const error = new Error(this.cleanupUncertainOnAbort ? "Spotify prefetch cleanup uncertain: destroy failed" : "aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return {
      variant,
      alreadyCached: false,
      cached: true,
      totalBytes: 100,
      transferredBytes: 100,
      networkBytes: 100,
      cachedBytes: 0,
      events: 2,
      elapsedMs: 5,
    };
  }

  close() { this.closed += 1; }
}

function instance() {
  return { generation: 1, log: (_message: string) => undefined } as any;
}

function confirmation(active: DownloadJob): PlaybackConfirmation {
  return {
    confirmed: true,
    isAd: false,
    gated: false,
    uri: `spotify:track:${active.trackId}`,
    fileId: "f".repeat(40),
    fileBitrate: 160_000,
  };
}

async function settle() {
  await Bun.sleep(5);
}

test("default lookahead is two queued jobs", async () => {
  expect(DEFAULT_PREFETCH_LOOKAHEAD).toBe(2);
  const adapter = new FakeAdapter();
  const controller = new QueuePrefetchController(instance(), adapter);
  const active = jobs.create(track(`active-default-${Date.now()}`));
  const queued = Array.from({ length: 5 }, (_, index) => jobs.create(track(`default-${index}-${Date.now()}`)));

  await controller.onPlaybackConfirmed(active, confirmation(active), queued.map(entry));
  await settle();

  expect(adapter.prefetched).toHaveLength(2);
  expect(queued.slice(0, 2).every((job) => job.prefetch?.state === "cached")).toBe(true);
  expect(queued.slice(2).every((job) => job.prefetch === undefined)).toBe(true);
  await controller.stop();
});

test("controller respects an explicit two-job lookahead and hands cached variant to capture", async () => {
  const adapter = new FakeAdapter();
  const controller = new QueuePrefetchController(instance(), adapter, 2);
  const active = jobs.create(track(`active-${Date.now()}`));
  const a = jobs.create(track(`a-${Date.now()}`));
  const b = jobs.create(track(`b-${Date.now()}`));
  const c = jobs.create(track(`c-${Date.now()}`));

  await controller.onPlaybackConfirmed(active, confirmation(active), [entry(a), entry(b), entry(c)]);
  await settle();

  expect(adapter.resolved).toEqual([`spotify:track:${a.trackId}`, `spotify:track:${b.trackId}`]);
  expect(adapter.prefetched).toHaveLength(2);
  expect(a.prefetch?.state).toBe("cached");
  expect(b.prefetch?.state).toBe("cached");
  expect(c.prefetch).toBeUndefined();
  const handed = await controller.handoff(a);
  expect(handed?.trackUri).toBe(`spotify:track:${a.trackId}`);
  await controller.stop();
});

test("controller aborts speculative work when a queued consumer disappears", async () => {
  const adapter = new FakeAdapter();
  adapter.block = true;
  const controller = new QueuePrefetchController(instance(), adapter, 2);
  const active = jobs.create(track(`active-cancel-${Date.now()}`));
  const queued = jobs.create(track(`queued-cancel-${Date.now()}`));

  await controller.onPlaybackConfirmed(active, confirmation(active), [entry(queued)]);
  await settle();
  controller.reconcile([]);
  await settle();

  expect(adapter.aborted).toContain(`spotify:track:${queued.trackId}`);
  await controller.stop();
});

test("cleanup uncertainty during an abort disables further speculation", async () => {
  const adapter = new FakeAdapter();
  adapter.block = true;
  adapter.cleanupUncertainOnAbort = true;
  const fakeInstance = instance();
  const controller = new QueuePrefetchController(fakeInstance, adapter, 2);
  const active = jobs.create(track(`active-cleanup-${Date.now()}`));
  const queued = jobs.create(track(`queued-cleanup-${Date.now()}`));

  await controller.onPlaybackConfirmed(active, confirmation(active), [entry(queued)]);
  await settle();
  controller.reconcile([]);
  await settle();

  expect(adapter.closed).toBe(1);
  await controller.stop();
});

test("two selected-variant mismatches disable prefetch for the generation", async () => {
  const adapter = new FakeAdapter();
  const fakeInstance = instance();
  const controller = new QueuePrefetchController(fakeInstance, adapter, 2);
  const a = jobs.create(track(`mismatch-a-${Date.now()}`));
  const b = jobs.create(track(`mismatch-b-${Date.now()}`));

  await controller.reportVariantMismatch(a);
  expect(adapter.closed).toBe(0);
  await controller.reportVariantMismatch(b);
  expect(adapter.closed).toBe(1);
  expect(a.prefetch?.state).toBe("missed");
  expect(b.prefetch?.state).toBe("missed");
});


test("renderer session loss disables prefetch for the generation and marks queued work uncertain", async () => {
  const adapter = new FakeAdapter();
  adapter.currentSelection = async () => { throw new Error("Spotify renderer session closed"); };
  const fakeInstance = instance();
  const controller = new QueuePrefetchController(fakeInstance, adapter, 2);
  const active = jobs.create(track(`renderer-loss-active-${Date.now()}`));
  const queued = jobs.create(track(`renderer-loss-queued-${Date.now()}`));

  await controller.onPlaybackConfirmed(active, confirmation(active), [entry(queued)]);

  expect(adapter.closed).toBe(1);
  expect(queued.prefetch).toMatchObject({ state: "error", reason: "cleanup-uncertain" });
  await controller.stop();
});
