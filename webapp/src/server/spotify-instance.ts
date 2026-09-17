import { spawn } from "bun";
import { existsSync, mkdirSync, unlinkSync, statSync } from "fs";
import { extname, join } from "path";
import { cloneSpotifyLoginState, resetSpotifyTransientRuntimeState, terminateProcessTree } from "../../../src/core/spotify-runtime";
import { sendIPC as sendIpcCommand } from "../../../src/core/ipc";
import { getDaemonSpotifyInstance } from "../../../src/core/daemon-runtime";
import { parsePlaybackConfirmation, requestTrackPlayback, waitForTrackCompletion } from "../../../src/core/capture-control";
import { captureMaxWaitMs, captureMonitorDecision, PlaybackProgressMonitor } from "../../../src/core/capture-monitor";
import { BestEffortCaptureTraceRecorder } from "../../../src/core/capture-trace";
import { migrateOfficialSpotifyAuthOnce } from "../../../src/core/auth-migration";
import { inspectOrphanSpotifyOwner, retireOrphanSpotifyOwner } from "../../../src/core/daemon-owner";
import { AUTH_STATE_DIR, CAPTURE_BACKEND, OUTPUT_DIR, PROFILES_DIR, WORKSPACE_DIR, IPC_SOCKET, SAVE_PATH } from "../../../src/core/paths";
import type { DownloadJob, TrackMetadata } from "./jobs";
import { copyAudioFallback, expectedOggBytes, findCapturedAudioPath, transcodeAudioToMp3, validateAudioFile, writeSidecar } from "./media";
import { jobs, GLOBAL_METADATA } from "./runtime-state";
import { fetchTrackDuration, fetchTrackMetadata } from "./spotify-metadata";
import { writeTrackTags } from "./id3";
import { BASE_DEBUG_PORT, MUTE_OUTPUT, RUNTIME_DIR, SOGGFY_HIDDEN, USE_DAEMON_INSTANCE } from "./runtime-config";

function parsePlainIpcResponse(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, value: "", raw };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return { ok: true, value: JSON.parse(trimmed), raw }; } catch {}
  }
  return { ok: !trimmed.startsWith("error"), value: trimmed, raw };
}


export function capturedBytesFromPath(capturePath: string, fallback: number): number {
  try {
    const size = statSync(capturePath).size;
    return capturePath.endsWith(".wav") ? Math.max(0, size - 44) : size;
  } catch {
    return fallback;
  }
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

export function sanitizedSpotifyEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  for (const key of Object.keys(sanitized)) {
    if (
      key === "SSLKEYLOGFILE"
      || key.startsWith("SOGGFY_")
      || /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i.test(key)
    ) {
      delete sanitized[key];
    }
  }
  return sanitized;
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

  private async retireOrphanedProfile(binaryPath: string, profileDir: string, label: string) {
    const orphanInspection = inspectOrphanSpotifyOwner(binaryPath, profileDir);
    if (orphanInspection.kind === "unavailable") {
      throw new Error(
        `Soggfy cannot inspect running Spotify processes; refusing to launch while checking ${label}.`,
      );
    }
    if (orphanInspection.kind === "verified") {
      this.log(`Retiring orphaned ${label} Spotify process ${orphanInspection.owner.spotifyPid} before launch.`);
      await retireOrphanSpotifyOwner(orphanInspection.owner);
      return;
    }
    if (orphanInspection.kind === "unverifiable") {
      throw new Error(
        `Spotify process ${orphanInspection.spotifyPid} still uses ${label}, but its identity cannot be verified safely.`,
      );
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
    resetSpotifyTransientRuntimeState(this.savePath);

    const appSupportSpotify = join(this.savePath, "Application Support/Spotify");
    try {
      const migration = migrateOfficialSpotifyAuthOnce();
      if (migration === "migrated") this.log("Migrated existing Spotify login state into Soggfy-owned auth state.");
      else if (migration === "upgraded") this.log("Upgraded Soggfy Spotify login state with required WebKit session data.");
    } catch (error) {
      this.log(`Warning: could not migrate existing Spotify login state: ${error instanceof Error ? error.message : String(error)}`);
    }
    const homeDir = join(this.profileDir, "home");
    const loginState = cloneSpotifyLoginState(appSupportSpotify, AUTH_STATE_DIR, {
      webKitDest: join(homeDir, "Library/WebKit/com.spotify.client"),
    });
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

    await this.retireOrphanedProfile(binaryPath, this.profileDir, `instance_${this.id} profile`);

    if (!USE_DAEMON_INSTANCE && this.id === 1) {
      const daemonProfileDir = join(PROFILES_DIR, "cli_instance");
      if (daemonProfileDir !== this.profileDir) {
        await this.retireOrphanedProfile(binaryPath, daemonProfileDir, "daemon Soggfy profile");
      }
    }

    const tmpDir = join(this.profileDir, "tmp");
    mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

    const env = {
      ...sanitizedSpotifyEnvironment(),
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
    const trace = new BestEffortCaptureTraceRecorder(trackId, {
      onError: (error) => jobs.log(
        job,
        `warning: capture trace disabled: ${error instanceof Error ? error.message : String(error)}`,
      ),
    });
    const tracedSend = async (
      command: string,
      retries = 4,
      timeoutMs = 2500,
    ): Promise<string> => {
      trace.command(command);
      try {
        const response = await this.sendIPC(command, retries, timeoutMs);
        trace.response(command, response);
        return response;
      } catch (error) {
        trace.record({
          type: "error",
          message: `IPC ${command}: ${error instanceof Error ? error.message : String(error)}`,
        });
        throw error;
      }
    };
    trace.record({ type: "phase", phase: "prepare" });
    jobs.log(job, trace.path ? `capture trace: ${trace.path ?? "unavailable"}` : "capture trace unavailable");
    assertJobActive(job);
    this.isBusy = true;
    this.currentTrack = trackId;
    this.currentJobId = job.id;
    jobs.transition(job, "assigned", { instanceId: this.id, attempts: job.attempts + 1 });

    try {
      this.statusText = `Starting: ${trackId}`;
      jobs.transition(job, "starting");
      assertJobActive(job);
      await tracedSend(`reset_track ${trackId}`);
      await tracedSend(`set_track ${trackId}`);

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
      trace.record({ type: "phase", phase: "awaiting_playback" });
      await requestTrackPlayback((command) => tracedSend(command, 1), trackId);

      // Wait for the target track to actually start playing (not an ad).
      // The dylib gates capture via PlaybackStateChanged notifications.
      let trackConfirmed = false;
      for (let i = 0; i < 30; i++) {
        assertJobActive(job);
        await new Promise((r) => setTimeout(r, 500));
        try {
          const playingRaw = await tracedSend("get_playing", 1);
          trace.record({ type: "playback", raw: playingRaw });
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
        trace.record({ type: "timeout", prerequisite: "target playback confirmation", elapsedMs: 15_000 });
        await tracedSend("pause").catch(() => undefined);
        throw new Error(`target track ${trackId} was not confirmed playing; trace: ${trace.path ?? "unavailable"}`);
      }

      trace.record({ type: "phase", phase: "awaiting_capture" });
      let status = "idle";
      for (let i = 0; i < 50; i++) {
        assertJobActive(job);
        await new Promise((r) => setTimeout(r, 500));
        status = await tracedSend(`get_status ${trackId}`, 1).catch(() => "idle");
        trace.record({ type: "status", status });
        const bytes = this.refreshCapturedBytes(job);
        trace.record({ type: "bytes", path: job.capturePath ?? "", bytes });
        if (status === "downloading" || status === "completed") break;
      }
      if (status !== "downloading" && status !== "completed") {
        trace.record({ type: "timeout", prerequisite: "audio interception", elapsedMs: 25_000 });
        await tracedSend("pause").catch(() => undefined);
        throw new Error(`audio interception timed out before capture started; trace: ${trace.path ?? "unavailable"}`);
      }

      trace.record({ type: "phase", phase: "capturing" });
      jobs.transition(job, "capturing");
      assertJobActive(job);
      const durationMs = await durationPromise.catch(() => null);
      if (durationMs && durationMs > 0) {
        await tracedSend(`set_duration ${trackId} ${durationMs}`).catch((err) => {
          jobs.log(job, `warning: set_duration failed: ${err.message}`);
        });
      }

      const started = Date.now();
      const playback = new PlaybackProgressMonitor(trackId, started);
      const maxCaptureMs = captureMaxWaitMs(durationMs);
      while (captureMonitorDecision(status, Date.now() - started, maxCaptureMs) === "continue") {
        assertJobActive(job);
        await new Promise((r) => setTimeout(r, 1000));
        status = await tracedSend(`get_status ${trackId}`, 1).catch(() => "ipc_lost");
        trace.record({ type: "status", status });
        const bytes = this.refreshCapturedBytes(job);
        trace.record({ type: "bytes", path: job.capturePath ?? "", bytes });
        playback.observeCaptureBytes(bytes);
        if (status === "ipc_lost") throw new Error("IPC lost during capture");
        if (status !== "completed") {
          const playbackRaw = await tracedSend("get_playing", 1).catch(() => "{}");
          trace.record({ type: "playback", raw: playbackRaw });
          playback.observe(playbackRaw);
        }
      }

      trace.record({ type: "phase", phase: "finalizing" });
      jobs.transition(job, "finalizing");
      assertJobActive(job);
      if (status !== "completed") {
        await tracedSend(`finish_track ${trackId}`).catch(() => undefined);
        const completed = await waitForTrackCompletion(
          (command) => tracedSend(command, 1),
          trackId,
        );
        if (!completed) {
          trace.record({ type: "timeout", prerequisite: "capture finalization", elapsedMs: 5_000 });
          throw new Error(`capture finalization timed out for ${trackId}; trace: ${trace.path ?? "unavailable"}`);
        }
        status = "completed";
      }
      await tracedSend("pause").catch(() => undefined);

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

      trace.record({ type: "phase", phase: "completed" });
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
      trace.record({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      trace.record({ type: "phase", phase: "failed" });
      await tracedSend("pause").catch(() => undefined);
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
    const bytes = capturedBytesFromPath(capturePath, job.bytesCaptured);
    if (bytes === job.bytesCaptured && !existsSync(capturePath)) return job.bytesCaptured;
    jobs.patch(job, {
      bytesCaptured: bytes,
      capturePath,
      wavPath: capturePath.endsWith(".wav") ? capturePath : undefined,
      oggPath: capturePath.endsWith(".ogg") ? capturePath : undefined,
    });
    return bytes;
  }

  private async writeTags(mp3Path: string, meta: TrackMetadata) {
    await writeTrackTags(mp3Path, meta, (message) => this.log(message));
  }}
