import { spawn } from "bun";
import { existsSync, mkdirSync, unlinkSync, statSync } from "fs";
import { extname, join } from "path";
import NodeID3 from "node-id3";
import { cloneSpotifyLoginState, terminateProcessTree } from "../../../src/core/spotify-runtime";
import { sendIPC as sendIpcCommand } from "../../../src/core/ipc";
import { getDaemonSpotifyInstance } from "../../../src/core/daemon-runtime";
import { parsePlaybackConfirmation, requestTrackPlayback, waitForTrackCompletion } from "../../../src/core/capture-control";
import { CAPTURE_BACKEND, OUTPUT_DIR, PROFILES_DIR, WORKSPACE_DIR, IPC_SOCKET, SAVE_PATH } from "../../../src/core/paths";
import type { DownloadJob, TrackMetadata } from "./jobs";
import { copyAudioFallback, expectedOggBytes, findCapturedAudioPath, transcodeAudioToMp3, validateAudioFile, writeSidecar } from "./media";
import { jobs, GLOBAL_METADATA } from "./runtime-state";
import { fetchTrackDuration, fetchTrackMetadata } from "./spotify-metadata";
import { BASE_DEBUG_PORT, MUTE_OUTPUT, RUNTIME_DIR, SOGGFY_HIDDEN, USE_DAEMON_INSTANCE } from "./runtime-config";

function parsePlainIpcResponse(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, value: "", raw };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return { ok: true, value: JSON.parse(trimmed), raw }; } catch {}
  }
  return { ok: !trimmed.startsWith("error"), value: trimmed, raw };
}

export class JobCancelledError extends Error {
  constructor(job: DownloadJob) {
    super(
      job.error && job.state === "cancelled"
        ? job.error
        : `job ${job.id} was cancelled`
    );
    this.name = "JobCancelledError";
  }
}

export class JobPriorityInterruptedError extends Error {
  constructor(job: DownloadJob) {
    super(`job ${job.id} interrupted for priority playback`);
    this.name = "JobPriorityInterruptedError";
  }
}

function assertJobActive(job: DownloadJob) {
  if (job.priorityInterrupted) throw new JobPriorityInterruptedError(job);
  if (job.state === "cancelled") throw new JobCancelledError(job);
}

export class SpotifyInstance {
  id: number;
  socketPath: string;
  savePath: string;
  profileDir: string;
  debugPort: number;
  process: any = null;
  isReady = false;
  isBusy = false;
  currentTrack: string | null = null;
  currentJobId: string | null = null;
  statusText = "Stopped";
  logs: string[] = [];
  lastHeartbeatAt?: string;
  lastError?: string;

  constructor(id: number) {
    this.id = id;
    if (USE_DAEMON_INSTANCE && id === 1) {
      this.socketPath = IPC_SOCKET;
      this.savePath = SAVE_PATH;
      this.profileDir = join(PROFILES_DIR, "cli_instance");
    } else {
      this.socketPath = join(RUNTIME_DIR, `instance_${id}.sock`);
      this.savePath = join(RUNTIME_DIR, `instance_${id}`);
      this.profileDir = join(PROFILES_DIR, `instance_${id}`);
    }
    this.debugPort = BASE_DEBUG_PORT + id;
  }

  log(msg: string) {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${msg}`;
    this.logs.push(formatted);
    if (this.logs.length > 100) this.logs.shift();
    console.log(`[Instance ${this.id}] ${msg}`);
  }

  snapshot() {
    return {
      id: this.id,
      socketPath: this.socketPath,
      savePath: this.savePath,
      profileDir: this.profileDir,
      debugPort: this.debugPort,
      isReady: this.isReady,
      isBusy: this.isBusy,
      currentTrack: this.currentTrack,
      currentJobId: this.currentJobId,
      statusText: this.statusText,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastError: this.lastError,
      logs: this.logs,
    };
  }

  async sendIPC(command: string, retries = 4, timeoutMs = 2500): Promise<string> {
    try {
      if (USE_DAEMON_INSTANCE && this.id === 1) {
        return await getDaemonSpotifyInstance().sendCommand(command);
      }
      return await sendIpcCommand(this.socketPath, command, { retries, timeoutMs });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const raw = await this.sendIPC("ping", 1, 1000);
      const parsed = parsePlainIpcResponse(raw);
      const ok = parsed.value === "pong" || parsed.value?.ok === true;
      if (ok) this.lastHeartbeatAt = new Date().toISOString();
      return ok;
    } catch {
      return false;
    }
  }

  async isRunning(): Promise<boolean> {
    if (!this.process?.pid) return false;
    try {
      process.kill(this.process.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async start() {
    this.statusText = "Starting";
    this.lastError = undefined;
    this.log("Initializing instance...");

    if (USE_DAEMON_INSTANCE && this.id === 1) {
      const daemonInstance = getDaemonSpotifyInstance();
      this.process = daemonInstance.process;
      if (!daemonInstance.isReady || !(await this.ping())) {
        this.statusText = "Socket Error";
        this.isReady = false;
        throw new Error(`Daemon Spotify IPC is not responsive at ${this.socketPath}`);
      }
      this.isReady = true;
      this.statusText = "Ready";
      this.log("Attached to daemon-owned Spotify instance.");
      return;
    }

    mkdirSync(this.savePath, { recursive: true, mode: 0o700 });
    mkdirSync(this.profileDir, { recursive: true, mode: 0o700 });

    const appSupportSpotify = join(this.savePath, "Application Support/Spotify");
    const loginState = cloneSpotifyLoginState(appSupportSpotify);
    if (loginState.copiedSessionCache) {
      this.log("Cloned reusable Spotify session state.");
    } else {
      this.log("Warning: reusable Spotify session state not found; run `soggfy auth login`.");
    }

    try {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
      const activeTrackTxt = join(this.savePath, "active_track.txt");
      if (existsSync(activeTrackTxt)) unlinkSync(activeTrackTxt);
      const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
      for (const lf of lockFiles) {
        const p = join(this.profileDir, lf);
        if (existsSync(p)) unlinkSync(p);
      }
    } catch {}

    const appPath = join(WORKSPACE_DIR, "PatchedSpotify.app");
    const binaryPath = join(appPath, "Contents/MacOS/Spotify");
    const dylibPath = join(appPath, "Contents/MacOS/libsoggfy.dylib");
    if (!existsSync(binaryPath)) throw new Error(`Patched Spotify binary missing: ${binaryPath}`);
    if (!existsSync(dylibPath)) throw new Error(`Payload dylib missing: ${dylibPath}`);

    const homeDir = join(this.profileDir, "home");
    const tmpDir = join(this.profileDir, "tmp");
    mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

    const env = {
      ...process.env,
      HOME: homeDir,
      TMPDIR: tmpDir,
      DYLD_INSERT_LIBRARIES: dylibPath,
      SOGGFY_SOCKET_PATH: this.socketPath,
      SOGGFY_SAVE_PATH: this.savePath,
      SOGGFY_NO_FOCUS: "1",
      SOGGFY_HIDDEN: SOGGFY_HIDDEN ? "1" : "0",
      SOGGFY_CAPTURE_BACKEND: CAPTURE_BACKEND,
      SOGGFY_MUTE_OUTPUT: MUTE_OUTPUT,
    };

    const cefFlags = [
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--renderer-process-limit=1",
      "--js-flags=--max-old-space-size=256",
      "--disable-extensions",
      "--disable-background-networking",
      `--remote-debugging-port=${this.debugPort}`,
      `--cache-path=${this.profileDir}`,
      `--user-data-dir=${this.profileDir}`,
    ];

    this.log(`Spawning Patched Spotify (hidden=${SOGGFY_HIDDEN}, debugPort=${this.debugPort})...`);
    this.process = spawn([binaryPath, ...cefFlags], { env, stdout: "pipe", stderr: "pipe" });
    this.pipeProcessLogs();

    const socketReady = await this.waitForSocketAndHooks();
    if (!socketReady) {
      this.statusText = "Socket Error";
      this.isReady = false;
      this.log("Error: IPC socket/hook handshake did not complete.");
      return;
    }

    this.isReady = true;
    this.statusText = "Ready";
    this.log("Instance ready.");
  }

  private pipeProcessLogs() {
    if (!this.process) return;
    const logWriter = Bun.file(join(this.profileDir, "spotify.log")).writer();
    const errWriter = Bun.file(join(this.profileDir, "spotify.err")).writer();
    (async () => {
      try {
        for await (const chunk of this.process.stdout) {
          logWriter.write(chunk);
          logWriter.flush();
        }
      } catch {}
      finally { logWriter.end(); }
    })();
    (async () => {
      try {
        for await (const chunk of this.process.stderr) {
          errWriter.write(chunk);
          errWriter.flush();
        }
      } catch {}
      finally { errWriter.end(); }
    })();
    this.process.exited.then((code: number) => {
      this.log(`Spotify process exited with code ${code}`);
      this.isReady = false;
      if (this.isBusy) this.lastError = `process exited during active job (${code})`;
    }).catch(() => {});
  }

  private async waitForSocketAndHooks(): Promise<boolean> {
    for (let i = 0; i < 60; i++) {
      if (this.process?.pid) {
        try { process.kill(this.process.pid, 0); }
        catch { return false; }
      }
      if (existsSync(this.socketPath)) {
        const ok = await this.ping();
        if (ok) return true;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  async stop() {
    this.log("Stopping instance...");
    this.isReady = false;
    this.isBusy = false;
    this.currentTrack = null;
    this.currentJobId = null;
    this.statusText = "Stopped";
    if (USE_DAEMON_INSTANCE && this.id === 1) {
      this.log("Detached from daemon-owned Spotify instance.");
      return;
    }
    if (this.process) {
      const pid = this.process.pid;
      await terminateProcessTree(pid, this.process.exited);
      this.process = null;
    }
    try {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
      const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
      for (const lf of lockFiles) {
        const p = join(this.profileDir, lf);
        if (existsSync(p)) unlinkSync(p);
      }
    } catch {}
  }

  async recycle(reason: string) {
    this.log(`Recycling instance: ${reason}`);
    if (USE_DAEMON_INSTANCE && this.id === 1) {
      this.isReady = await this.ping();
      this.statusText = this.isReady ? "Ready" : "Socket Error";
      if (!this.isReady) throw new Error("Daemon-owned Spotify instance is not responsive; restart the Soggfy daemon");
      return;
    }
    await this.stop();
    await new Promise((r) => setTimeout(r, 1000));
    await this.start();
  }

  async downloadJob(job: DownloadJob): Promise<DownloadJob> {
    const trackId = job.trackId;
    assertJobActive(job);
    this.isBusy = true;
    this.currentTrack = trackId;
    this.currentJobId = job.id;
    jobs.transition(job, "assigned", { instanceId: this.id, attempts: job.attempts + 1 });

    try {
      this.statusText = `Starting: ${trackId}`;
      jobs.transition(job, "starting");
      assertJobActive(job);
      await this.sendIPC(`reset_track ${trackId}`);
      await this.sendIPC(`set_track ${trackId}`);

      const metadataPromise = fetchTrackMetadata(trackId).then((meta) => {
        if (meta) {
          GLOBAL_METADATA[trackId] = meta;
          jobs.patch(job, { metadata: meta }, "metadata resolved");
        }
        return meta;
      });
      const durationPromise = fetchTrackDuration(trackId).then((durationMs) => {
        if (durationMs && durationMs > 0) {
          jobs.patch(job, {
            durationMs,
            expectedBytes: expectedOggBytes(durationMs),
          }, `duration=${durationMs}ms`);
        }
        return durationMs;
      });

      this.statusText = `Playing: ${trackId}`;
      jobs.transition(job, "playing");
      assertJobActive(job);
      await requestTrackPlayback((command) => this.sendIPC(command, 1), trackId);

      // Wait for the target track to actually start playing (not an ad).
      // The dylib gates capture via PlaybackStateChanged notifications.
      let trackConfirmed = false;
      for (let i = 0; i < 30; i++) {
        assertJobActive(job);
        await new Promise((r) => setTimeout(r, 500));
        try {
          const playingRaw = await this.sendIPC("get_playing", 1);
          const playing = parsePlaybackConfirmation(playingRaw, trackId);
          if (playing.isAd) {
            if (i % 4 === 0) jobs.log(job, `waiting: ad playing (${playing.uri})`);
          } else if (playing.confirmed) {
            trackConfirmed = true;
            jobs.log(job, "target track confirmed playing");
            break;
          }
        } catch {}

      }
      if (!trackConfirmed) {
        await this.sendIPC("pause").catch(() => undefined);
        throw new Error(`target track ${trackId} was not confirmed playing`);
      }

      let status = "idle";
      for (let i = 0; i < 50; i++) {
        assertJobActive(job);
        await new Promise((r) => setTimeout(r, 500));
        status = await this.sendIPC(`get_status ${trackId}`, 1).catch(() => "idle");
        this.refreshCapturedBytes(job);
        if (status === "downloading" || status === "completed") break;
      }
      if (status !== "downloading" && status !== "completed") {
        await this.sendIPC("pause").catch(() => undefined);
        throw new Error("audio interception timed out before capture started");
      }

      jobs.transition(job, "capturing");
      assertJobActive(job);
      const durationMs = await durationPromise.catch(() => null);
      if (durationMs && durationMs > 0) {
        await this.sendIPC(`set_duration ${trackId} ${durationMs}`).catch((err) => {
          jobs.log(job, `warning: set_duration failed: ${err.message}`);
        });
      }

      const started = Date.now();
      const maxCaptureMs = Math.max((durationMs || 240000) + 30000, 90000);
      let lastBytes = -1;
      let stagnantTicks = 0;
      while (status !== "completed" && Date.now() - started < maxCaptureMs) {
        assertJobActive(job);
        await new Promise((r) => setTimeout(r, 1000));
        status = await this.sendIPC(`get_status ${trackId}`, 1).catch(() => "ipc_lost");
        const bytes = this.refreshCapturedBytes(job);
        if (bytes === lastBytes) stagnantTicks += 1;
        else stagnantTicks = 0;
        lastBytes = bytes;
        if (status === "ipc_lost") throw new Error("IPC lost during capture");
        if (stagnantTicks >= 20 && bytes > 44) {
          jobs.log(job, "capture appears stagnant; finalizing defensively");
          break;
        }
      }

      jobs.transition(job, "finalizing");
      assertJobActive(job);
      if (status !== "completed") {
        await this.sendIPC(`finish_track ${trackId}`).catch(() => undefined);
        const completed = await waitForTrackCompletion(
          (command) => this.sendIPC(command, 1),
          trackId,
        );
        if (!completed) throw new Error(`capture finalization timed out for ${trackId}`);
        status = "completed";
      }
      await this.sendIPC("pause").catch(() => undefined);

      const capturePath = findCapturedAudioPath(this.savePath, trackId);
      if (!capturePath) throw new Error("captured audio file not found in temp cache");

      this.refreshCapturedBytes(job);
      const validation = validateAudioFile(capturePath, job.durationMs);
      jobs.patch(job, { validation, capturePath }, `audio validation warnings=${validation.warnings.length}`);
      if (!validation.ok) {
        throw new Error(`invalid audio capture: ${validation.warnings.join(",") || "validation failed"}`);
      }

      jobs.transition(job, "transcoding");
      assertJobActive(job);
      const finalMp3Path = join(OUTPUT_DIR, `${trackId}.mp3`);
      const transcode = transcodeAudioToMp3(capturePath, finalMp3Path);
      let savedPath: string;
      let outputFormat: "mp3" | "wav" | "ogg";
      if (transcode.ok) {
        const outputValidation = validateAudioFile(finalMp3Path, job.durationMs);
        if (!outputValidation.ok) {
          throw new Error(`transcoded output failed validation: ${outputValidation.warnings.join(",") || "validation failed"}`);
        }
        savedPath = finalMp3Path;
        outputFormat = "mp3";
      } else {
        jobs.log(job, `ffmpeg failed; preserving validated capture: ${transcode.stderr}`);
        savedPath = copyAudioFallback(capturePath, OUTPUT_DIR, trackId);
        outputFormat = extname(savedPath).slice(1).toLowerCase() === "ogg" ? "ogg" : "wav";
      }
      assertJobActive(job);

      const meta = await metadataPromise.catch(() => null);
      if (outputFormat === "mp3" && meta) {
        await this.writeTags(finalMp3Path, meta);
      }

      assertJobActive(job);
      const sizeBytes = statSync(savedPath).size;
      writeSidecar(savedPath, {
        jobId: job.id,
        trackId,
        state: "completed",
        outputFormat,
        savedPath,
        sizeBytes,
        durationMs: job.durationMs,
        expectedBytes: job.expectedBytes,
        bytesCaptured: job.bytesCaptured,
        validation,
        metadata: meta || job.metadata,
        completedAt: new Date().toISOString(),
      });

      return jobs.complete(job, {
        savedPath,
        capturePath,
        wavPath: capturePath.endsWith(".wav") ? capturePath : undefined,
        oggPath: capturePath.endsWith(".ogg") ? capturePath : undefined,
        mp3Path: outputFormat === "mp3" ? finalMp3Path : undefined,
        outputFormat,
        sizeBytes,
        metadata: meta || job.metadata,
      });
    } catch (err) {
      await this.sendIPC("pause").catch(() => undefined);
      throw err;
    } finally {
      this.statusText = "Ready";
      this.currentTrack = null;
      this.currentJobId = null;
      this.isBusy = false;
    }
  }

  private refreshCapturedBytes(job: DownloadJob): number {
    const capturePath = findCapturedAudioPath(this.savePath, job.trackId);
    if (!capturePath) return job.bytesCaptured;
    const size = statSync(capturePath).size;
    const bytes = capturePath.endsWith(".wav") ? Math.max(0, size - 44) : size;
    jobs.patch(job, {
      bytesCaptured: bytes,
      capturePath,
      wavPath: capturePath.endsWith(".wav") ? capturePath : undefined,
      oggPath: capturePath.endsWith(".ogg") ? capturePath : undefined,
    });
    return bytes;
  }

  private async writeTags(mp3Path: string, meta: TrackMetadata) {
    let coverBuffer = null;
    if (meta.coverUrl) {
      try {
        const imgRes = await fetch(meta.coverUrl);
        coverBuffer = Buffer.from(await imgRes.arrayBuffer());
      } catch {}
    }
    const tags: any = { title: meta.title, artist: meta.artist };
    if (coverBuffer) {
      tags.image = { mime: "image/jpeg", type: { id: 3, name: "front cover" }, description: "Cover", imageBuffer: coverBuffer };
    }
    try { NodeID3.write(tags, mp3Path); } catch (err: any) { this.log(`Warning: failed to write ID3 tags: ${err.message}`); }
  }
}
