import { PATCHED_APP } from "../../../src/core/paths";
import { readSpotifyBundleVersion } from "../../../src/core/spotify-runtime";
import { isSpotifyPrefetchSupported } from "../../../src/core/spotify-compatibility";
import {
  SpotifyPrefetchAdapter,
  type CurrentPrefetchSelection,
  type PrefetchPolicy,
  type PrefetchResult,
  type PrefetchVariant,
} from "../../../src/core/spotify-prefetch";
import type { PlaybackConfirmation } from "../../../src/core/capture-control";
import type { DownloadJob } from "./jobs";
import type { QueueEntry } from "./priority-queue";
import { jobs } from "./runtime-state";
import type { SpotifyInstance } from "./spotify-instance";
import { PREFETCH_MODE, USE_DAEMON_INSTANCE } from "./runtime-config";

export const DEFAULT_PREFETCH_LOOKAHEAD = 2;

export interface PrefetchAdapterPort {
  currentSelection(trackUri: string): Promise<CurrentPrefetchSelection | null>;
  resolveVariant(trackUri: string, policy: PrefetchPolicy): Promise<PrefetchVariant | null>;
  prefetch(variant: PrefetchVariant, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<PrefetchResult>;
  close(): void;
}

interface PrefetchTask {
  key: string;
  variant: PrefetchVariant;
  consumers: Set<string>;
  controller: AbortController;
  state: "prefetching" | "cached" | "failed";
  result?: PrefetchResult;
  promise: Promise<void>;
}

function variantKey(variant: PrefetchVariant): string {
  return `${variant.formatEnum}:${variant.bitrate}:${variant.fileId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function boundedReason(error: unknown): "cleanup-uncertain" | "prefetch-failed" {
  const message = error instanceof Error ? error.message : String(error);
  return /cleanup uncertain|uncertain cleanup|generation changed|renderer session (?:closed|failed)|renderer connection|target crashed/i.test(message)
    ? "cleanup-uncertain"
    : "prefetch-failed";
}

export class QueuePrefetchController {
  private policy: PrefetchPolicy | null = null;
  private tasks = new Map<string, PrefetchTask>();
  private jobToTask = new Map<string, string>();
  private stopped = false;
  private disabled = false;
  private mismatchCount = 0;

  constructor(
    private readonly instance: SpotifyInstance,
    private readonly adapter: PrefetchAdapterPort,
    private readonly lookahead = DEFAULT_PREFETCH_LOOKAHEAD,
  ) {}

  private patch(job: DownloadJob, patch: DownloadJob["prefetch"], log?: string) {
    jobs.patch(job, { prefetch: patch }, log);
  }

  private currentTargets(queue: readonly QueueEntry[]): DownloadJob[] {
    return queue
      .map((entry) => entry.job)
      .filter((job) => job.state === "queued")
      .slice(0, this.lookahead);
  }

  async onPlaybackConfirmed(
    activeJob: DownloadJob,
    confirmation: PlaybackConfirmation,
    queue: readonly QueueEntry[],
  ): Promise<string | undefined> {
    if (this.stopped || this.disabled) return confirmation.fileId;
    try {
      const selection = await this.adapter.currentSelection(confirmation.uri);
      if (!selection) {
        this.policy = null;
        for (const job of this.currentTargets(queue)) {
          this.patch(job, { state: "skipped", reason: "unknown-policy", updatedAt: nowIso() });
        }
        return confirmation.fileId;
      }
      this.policy = selection.policy;
      jobs.log(activeJob, `prefetch policy format=${this.policy.formatEnum} bitrate=${this.policy.bitrate} file=${selection.fileId}`);
      this.reconcile(queue);
      return selection.fileId;
    } catch (error) {
      jobs.log(activeJob, `prefetch policy unavailable: ${error instanceof Error ? error.message : String(error)}`);
      this.policy = null;
      if (boundedReason(error) === "cleanup-uncertain") {
        for (const job of this.currentTargets(queue)) {
          this.patch(job, { state: "error", reason: "cleanup-uncertain", updatedAt: nowIso() });
        }
        await this.disableForGeneration("cleanup-uncertain");
      }
      return confirmation.fileId;
    }
  }

  reconcile(queue: readonly QueueEntry[]): void {
    if (this.stopped || this.disabled) return;
    const targets = this.currentTargets(queue);
    const targetIDs = new Set(targets.map((job) => job.id));

    for (const [key, task] of this.tasks) {
      for (const jobID of [...task.consumers]) {
        if (targetIDs.has(jobID)) continue;
        task.consumers.delete(jobID);
        if (this.jobToTask.get(jobID) === key) this.jobToTask.delete(jobID);
      }
      if (task.consumers.size === 0) {
        if (task.state === "prefetching") task.controller.abort();
        this.tasks.delete(key);
      }
    }

    if (!this.policy) return;
    for (const job of targets) {
      if (!this.jobToTask.has(job.id)) void this.ensureJob(job, this.policy);
    }
  }

  private async ensureJob(job: DownloadJob, policy: PrefetchPolicy): Promise<void> {
    if (this.stopped || this.disabled || this.jobToTask.has(job.id) || job.state !== "queued") return;
    this.patch(job, { state: "resolving", updatedAt: nowIso() });
    let variant: PrefetchVariant | null;
    try {
      variant = await this.adapter.resolveVariant(`spotify:track:${job.trackId}`, policy);
    } catch (error) {
      if (this.stopped || this.disabled) return;
      const reason = boundedReason(error);
      this.patch(job, { state: "error", reason, updatedAt: nowIso() }, `prefetch resolve failed: ${error instanceof Error ? error.message : String(error)}`);
      if (reason === "cleanup-uncertain") await this.disableForGeneration(reason);
      return;
    }
    if (this.stopped || this.disabled || job.state !== "queued") return;
    if (!variant) {
      this.patch(job, { state: "skipped", reason: "ambiguous-variant", updatedAt: nowIso() });
      return;
    }

    const key = variantKey(variant);
    const existing = this.tasks.get(key);
    if (existing) {
      existing.consumers.add(job.id);
      this.jobToTask.set(job.id, key);
      if (existing.state === "cached" && existing.result) {
        this.patch(job, {
          state: "cached",
          totalBytes: existing.result.totalBytes,
          networkBytes: existing.result.networkBytes,
          cachedBytes: existing.result.cachedBytes,
          elapsedMs: existing.result.elapsedMs,
          updatedAt: nowIso(),
        });
      } else {
        this.patch(job, { state: "prefetching", updatedAt: nowIso() });
      }
      return;
    }

    const controller = new AbortController();
    const task: PrefetchTask = {
      key,
      variant,
      consumers: new Set([job.id]),
      controller,
      state: "prefetching",
      promise: Promise.resolve(),
    };
    this.tasks.set(key, task);
    this.jobToTask.set(job.id, key);
    this.patch(job, { state: "prefetching", updatedAt: nowIso() });

    task.promise = this.adapter.prefetch(variant, { signal: controller.signal })
      .then((result) => {
        if (this.stopped || this.disabled) return;
        task.state = "cached";
        task.result = result;
        for (const consumerID of task.consumers) {
          const consumer = jobs.get(consumerID);
          if (!consumer || consumer.state !== "queued") continue;
          this.patch(consumer, {
            state: "cached",
            totalBytes: result.totalBytes,
            networkBytes: result.networkBytes,
            cachedBytes: result.cachedBytes,
            elapsedMs: result.elapsedMs,
            updatedAt: nowIso(),
          }, `prefetched exact Spotify variant in ${Math.round(result.elapsedMs)}ms`);
        }
      })
      .catch(async (error) => {
        task.state = "failed";
        const reason = boundedReason(error);
        if ((controller.signal.aborted || this.stopped) && reason !== "cleanup-uncertain") return;
        for (const consumerID of task.consumers) {
          const consumer = jobs.get(consumerID);
          if (!consumer || consumer.state !== "queued") continue;
          this.patch(consumer, { state: "error", reason, updatedAt: nowIso() }, `prefetch failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (reason === "cleanup-uncertain") await this.disableForGeneration(reason);
      });
  }

  async handoff(job: DownloadJob): Promise<PrefetchVariant | undefined> {
    const key = this.jobToTask.get(job.id);
    if (!key) return undefined;
    const task = this.tasks.get(key);
    this.jobToTask.delete(job.id);
    if (!task) return undefined;
    task.consumers.delete(job.id);

    if (task.state === "cached" && task.result?.cached) {
      if (task.consumers.size === 0) this.tasks.delete(key);
      return task.variant;
    }

    if (task.state === "prefetching") {
      task.controller.abort();
      await task.promise.catch(() => undefined);
    }
    this.tasks.delete(key);
    if (job.state === "queued") {
      this.patch(job, { state: "skipped", reason: "cancelled", updatedAt: nowIso() }, "prefetch handoff cancelled unfinished speculative acquisition");
    }
    return undefined;
  }

  async reportVariantMismatch(job: DownloadJob): Promise<void> {
    this.mismatchCount += 1;
    this.patch(job, { state: "missed", reason: "variant-mismatch", updatedAt: nowIso() });
    if (this.mismatchCount >= 2) await this.disableForGeneration("prefetch-failed");
  }

  private async disableForGeneration(reason: "cleanup-uncertain" | "prefetch-failed") {
    if (this.disabled) return;
    this.disabled = true;
    for (const task of this.tasks.values()) {
      if (task.state === "prefetching") task.controller.abort();
    }
    await Promise.allSettled([...this.tasks.values()].map((task) => task.promise));
    for (const task of this.tasks.values()) {
      for (const jobID of task.consumers) {
        const job = jobs.get(jobID);
        if (job?.state === "queued") this.patch(job, { state: "error", reason, updatedAt: nowIso() });
      }
    }
    this.tasks.clear();
    this.jobToTask.clear();
    this.adapter.close();
    this.instance.log(`Prefetch disabled for instance generation ${this.instance.generation}: ${reason}`);
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const task of this.tasks.values()) task.controller.abort();
    await Promise.allSettled([...this.tasks.values()].map((task) => task.promise));
    this.tasks.clear();
    this.jobToTask.clear();
    this.adapter.close();
  }
}

export function createQueuePrefetchController(instance: SpotifyInstance): QueuePrefetchController | null {
  if (PREFETCH_MODE === "off") return null;
  if (!USE_DAEMON_INSTANCE) {
    throw new Error("SOGGFY_PREFETCH=1 is supported only by the daemon-backed single-instance web runtime");
  }
  const version = readSpotifyBundleVersion(PATCHED_APP);
  if (!version || !isSpotifyPrefetchSupported(version)) {
    throw new Error(`SOGGFY_PREFETCH=1 is not validated for Spotify build ${version ?? "unknown"}`);
  }
  const adapter = new SpotifyPrefetchAdapter({
    debugPort: instance.debugPort,
    spotifyVersion: version,
    generation: instance.generation,
    generationProvider: () => instance.generation,
  });
  instance.log(`Prefetch enabled for Spotify ${version}, generation ${instance.generation}, lookahead=${DEFAULT_PREFETCH_LOOKAHEAD}`);
  return new QueuePrefetchController(instance, adapter, DEFAULT_PREFETCH_LOOKAHEAD);
}
