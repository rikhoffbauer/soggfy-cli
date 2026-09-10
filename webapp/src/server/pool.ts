import { resolvePlayableTrackId } from "../../../src/core/metadata";
import { parseTrackId } from "./spotify-url";
import type { DownloadJob, TrackMetadata } from "./jobs";
import { PriorityJobQueue, type QueueEntry } from "./priority-queue";
import { jobs, GLOBAL_METADATA } from "./runtime-state";
import { findOutputForTrack } from "./outputs";
import { MAX_ATTEMPTS, USE_DAEMON_INSTANCE } from "./runtime-config";
import { preparePayload } from "./runtime-setup";
import { SpotifyInstance, JobCancelledError, JobPriorityInterruptedError } from "./spotify-instance";

export class SpotifyPoolManager {
  instances: SpotifyInstance[] = [];
  queue = new PriorityJobQueue();
  started = false;

  constructor(size: number) {
    for (let i = 1; i <= size; i++) this.instances.push(new SpotifyInstance(i));
  }

  async start() {
    if (!USE_DAEMON_INSTANCE) await preparePayload();
    console.log(`[Server] ${USE_DAEMON_INSTANCE ? "Attaching to daemon Spotify instance" : `Starting Spotify pool with ${this.instances.length} instances`}...`);
    for (const inst of this.instances) {
      try {
        await inst.start();
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err: any) {
        inst.lastError = err.message;
        inst.log(`Startup failed: ${err.message}`);
      }
    }
    this.started = true;
    this.startWatchdog();
    console.log(`[Server] Pool startup complete.`);
  }

  async stop() {
    console.log(`[Server] Shutting down Spotify pool...`);
    await Promise.all(this.instances.map((inst) => inst.stop()));
  }

  private queueEntry(job: DownloadJob): QueueEntry {
    return {
      job,
      resolve: () => undefined,
      reject: (error) => console.error(`[Server] Job ${job.id} failed: ${error.message}`),
    };
  }

  addResolvedJob(trackId: string, metadata?: TrackMetadata, note?: string): DownloadJob {
    const parsedTrackId = parseTrackId(trackId);
    if (!parsedTrackId) throw new Error("Invalid Spotify track URL, URI, or ID format");
    const reusable = jobs.findReusable(parsedTrackId);
    if (reusable) return reusable;
    if (metadata) GLOBAL_METADATA[parsedTrackId] = metadata;
    const job = jobs.create(parsedTrackId, metadata);
    if (note) jobs.log(job, note);
    this.queue.enqueue(this.queueEntry(job));
    this.dispatch();
    return job;
  }

  async addJob(trackParam: string): Promise<DownloadJob> {
    const requestedTrackId = parseTrackId(trackParam);
    if (!requestedTrackId) throw new Error("Invalid Spotify track URL, URI, or ID format");
    const resolution = await resolvePlayableTrackId(requestedTrackId);
    return this.addResolvedJob(
      resolution.trackId,
      resolution.metadata,
      resolution.relinked ? `relinked unavailable Spotify track ${requestedTrackId} -> ${resolution.trackId}` : undefined,
    );
  }

  async playNow(trackParam: string): Promise<{ job: DownloadJob; interruptedJobId?: string }> {
    const requestedTrackId = parseTrackId(trackParam);
    if (!requestedTrackId) throw new Error("Invalid Spotify track URL, URI, or ID format");

    const job = await this.addJob(requestedTrackId);
    const trackId = job.trackId;
    const alreadyActive = this.instances.find((inst) => inst.isBusy && inst.currentTrack === trackId);
    if (alreadyActive?.currentJobId === job.id) return { job };
    if (job.state === "completed" && findOutputForTrack(trackId)) return { job };
    if (!this.queue.find(job.id) && !this.instances.some((inst) => inst.currentJobId === job.id)) {
      this.queue.enqueue(this.queueEntry(job));
    }
    this.queue.promote(job.id);

    const activeInstance = this.instances.find((inst) => inst.isBusy && inst.currentTrack !== trackId);
    const activeJob = activeInstance?.currentJobId ? jobs.get(activeInstance.currentJobId) : undefined;
    const interruptible = activeJob && ["assigned", "starting", "playing", "capturing"].includes(activeJob.state);
    const interrupted = interruptible ? activeJob : undefined;
    if (activeInstance && interrupted && !interrupted.priorityInterrupted) {
      jobs.patch(interrupted, { priorityInterrupted: true }, `interrupted for priority playback of ${trackId}`);
      await activeInstance.sendIPC(`cancel_track ${interrupted.trackId}`, 1, 1000).catch(() => undefined);
      await activeInstance.sendIPC("pause", 1, 1000).catch(() => undefined);
    }

    this.dispatch();
    return { job, interruptedJobId: interrupted?.id };
  }

  async cancelJob(jobId: string, reason = "cancelled by user"): Promise<DownloadJob> {
    const job = jobs.get(jobId);
    if (!job) throw new Error(`Unknown job: ${jobId}`);
    if (jobs.isTerminal(job)) return job;

    const queued = this.queue.remove(jobId);
    if (queued) {
      jobs.cancel(job, reason);
      queued.reject(new JobCancelledError(job));
      return job;
    }

    const instance = this.instances.find((inst) => inst.currentJobId === jobId);
    jobs.cancel(job, reason);
    if (instance) {
      instance.log(`Cancelling active job ${jobId}: ${reason}`);
      await instance.sendIPC(`cancel_track ${job.trackId}`, 1, 1000).catch(() => undefined);
      await instance.sendIPC("pause", 1, 1000).catch(() => undefined);
      await instance.recycle(`cancelled job ${jobId}`).catch((err) => instance.log(`cancel recycle failed: ${err.message}`));
    }
    this.dispatch();
    return job;
  }

  async retryJob(jobId: string): Promise<DownloadJob> {
    const job = jobs.get(jobId);
    if (!job) throw new Error(`Unknown job: ${jobId}`);
    if (job.state !== "failed" && job.state !== "cancelled") {
      throw new Error(`Only failed or cancelled jobs can be retried; current state is ${job.state}`);
    }
    jobs.log(job, "retry requested; creating replacement job");
    return this.addJob(job.trackId);
  }

  private dispatch() {
    const idleInstance = this.instances.find((inst) => inst.isReady && !inst.isBusy);
    if (!idleInstance) return;
    const queued = this.queue.shift();
    if (!queued) return;

    idleInstance.downloadJob(queued.job)
      .then((res) => queued.resolve(res))
      .catch(async (err: Error) => {
        if (err instanceof JobPriorityInterruptedError) {
          jobs.log(queued.job, `priority interruption completed on instance ${idleInstance.id}`);
          jobs.requeueAfterPriorityInterruption(queued.job);
          this.queue.insertInterrupted(queued);
          return;
        }
        jobs.log(queued.job, `attempt failed on instance ${idleInstance.id}: ${err.message}`);
        if (queued.job.state === "cancelled" || err instanceof JobCancelledError) {
          queued.reject(err);
          return;
        }
        if (queued.job.attempts < MAX_ATTEMPTS) {
          jobs.transition(queued.job, "queued", { instanceId: undefined, error: undefined });
          this.queue.enqueue(queued);
          await idleInstance.recycle(err.message).catch((recycleErr) => idleInstance.log(`recycle failed: ${recycleErr.message}`));
        } else {
          jobs.fail(queued.job, err);
          queued.reject(err);
        }
      })
      .finally(() => this.dispatch());
  }

  private startWatchdog() {
    setInterval(async () => {
      for (const inst of this.instances) {
        if (!inst.isReady || inst.isBusy) continue;
        const ok = await inst.ping();
        if (!ok) await inst.recycle("watchdog ping failed").catch((err) => inst.log(`watchdog recycle failed: ${err.message}`));
      }
      this.dispatch();
    }, 15_000).unref?.();
  }

  snapshots() {
    return this.instances.map((inst) => inst.snapshot());
  }
}
