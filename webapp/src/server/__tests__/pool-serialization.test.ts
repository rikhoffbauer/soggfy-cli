import { expect, test } from "bun:test";
import type { DownloadJob } from "../jobs";
import { SpotifyPoolManager } from "../pool";
import { jobs } from "../runtime-state";

const CLI_TRACK_A = "AAAAAAAAAAAAAAAAAAAAAA";
const CLI_TRACK_B = "BBBBBBBBBBBBBBBBBBBBBB";
const WEB_TRACK = "CCCCCCCCCCCCCCCCCCCCCC";
const AFTER_FAILURE_TRACK = "DDDDDDDDDDDDDDDDDDDDDD";

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error("Timed out waiting for scheduler fixture");
}

function installRecordingInstance(
  pool: SpotifyPoolManager,
  run: (job: DownloadJob) => Promise<void>,
): void {
  const fake = {
    isReady: true,
    isBusy: false,
    currentTrack: undefined as string | undefined,
    currentJobId: undefined as string | undefined,
    async downloadJob(job: DownloadJob) {
      this.isBusy = true;
      this.currentTrack = job.trackId;
      this.currentJobId = job.id;
      try {
        await run(job);
        return job;
      } finally {
        this.isBusy = false;
        this.currentTrack = undefined;
        this.currentJobId = undefined;
      }
    },
  };
  pool.instances = [fake as any];
}

test("shared scheduler serializes two CLI-backed requests and one web request", async () => {
  const pool = new SpotifyPoolManager(0);
  const started: string[] = [];
  const finished: string[] = [];
  let active = 0;
  let maxActive = 0;

  installRecordingInstance(pool, async (job) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    started.push(job.trackId);
    jobs.transition(job, "capturing", { attempts: job.attempts + 1, instanceId: 1 });
    await Bun.sleep(20);
    jobs.complete(job);
    finished.push(job.trackId);
    active -= 1;
  });

  const cliA = pool.addResolvedJob(CLI_TRACK_A);
  const cliB = pool.addResolvedJob(CLI_TRACK_B);
  const web = pool.addResolvedJob(WEB_TRACK);

  await waitFor(() => [cliA, cliB, web].every((job) => job.state === "completed"));

  expect(maxActive).toBe(1);
  expect(started).toEqual([CLI_TRACK_A, CLI_TRACK_B, WEB_TRACK]);
  expect(finished).toEqual(started);
});

test("scheduler releases ownership after a terminal capture failure", async () => {
  const pool = new SpotifyPoolManager(0);
  const started: string[] = [];

  installRecordingInstance(pool, async (job) => {
    started.push(job.trackId);
    const terminalFailure = job.trackId === CLI_TRACK_A;
    jobs.transition(job, "capturing", { attempts: terminalFailure ? 3 : 1, instanceId: 1 });
    await Bun.sleep(10);
    if (terminalFailure) throw new Error("fixture capture failure");
    jobs.complete(job);
  });

  const failed = pool.addResolvedJob(CLI_TRACK_A);
  const next = pool.addResolvedJob(AFTER_FAILURE_TRACK);

  await waitFor(() => failed.state === "failed" && next.state === "completed");

  expect(started).toEqual([CLI_TRACK_A, AFTER_FAILURE_TRACK]);
  expect(failed.error).toContain("fixture capture failure");
  expect(next.state).toBe("completed");
});

test("health check restores an unready instance once IPC responds again", async () => {
  const pool = new SpotifyPoolManager(0);
  const logs: string[] = [];
  const instance = {
    isReady: false,
    isBusy: false,
    statusText: "Socket Error",
    lastError: "daemon IPC unavailable",
    ping: async () => true,
    recycle: async () => undefined,
    log: (message: string) => logs.push(message),
  };

  await (pool as any).refreshInstanceHealth(instance);

  expect(instance.isReady).toBe(true);
  expect(instance.statusText).toBe("Ready");
  expect(instance.lastError).toBeUndefined();
  expect(logs).toContain("Watchdog restored instance readiness.");
});
