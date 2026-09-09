#!/usr/bin/env bun
import { spawn } from "bun";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  statSync,
} from "fs";
import { spawnSync } from "child_process";
import { dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import index from "./index.html";
import NodeID3 from "node-id3";
import { ZipArchive } from "archiver";
import { assertSupportedSpotifyBundle, cloneSpotifyLoginState, terminateProcessTree } from "../../src/core/spotify-runtime";
import { sendIPC as sendIpcCommand } from "../../src/core/ipc";
import { getDaemonSpotifyInstance } from "../../src/core/daemon-runtime";
import { getHttpConfig } from "../../src/core/http-config";
import { parsePlaybackConfirmation, waitForTrackCompletion } from "../../src/core/capture-control";
import { groupSearchResults, searchSpotify } from "../../src/core/spotify-search";
import {
  fetchAllSpotifyPlaylistTracks,
  fetchSpotifyPlaylistPage,
  type SpotifyPlaylistTrack,
} from "../../src/core/spotify-playlist";
import { resolveInput as resolveSpotifyInput } from "../../src/core/metadata";
import { fetchSpotifyLyrics } from "../../src/core/spotify-lyrics";
import {
  CAPTURE_BACKEND,
  OUTPUT_DIR,
  PROFILES_DIR,
  SOGGFY_HOME,
  WORKSPACE_DIR,
  IPC_SOCKET,
  SAVE_PATH,
} from "../../src/core/paths";
import { CORS_HEADERS, jsonResponse, serveFileWithRange } from "./server/http";
import { extractTrackIds, parseAlbumId, parsePlaylistId, parseTrackId } from "./server/spotify-url";
import {
  JobRegistry,
  type DownloadJob,
  type TrackMetadata,
} from "./server/jobs";
import { PriorityJobQueue, type QueueEntry } from "./server/priority-queue";
import {
  copyAudioFallback,
  displayFileName,
  expectedOggBytes,
  ffprobeOk,
  findCapturedAudioPath,
  transcodeAudioToMp3,
  validateAudioFile,
  writeSidecar,
} from "./server/media";

const HTTP_CONFIG = getHttpConfig();
const PORT = HTTP_CONFIG.port;
const HOSTNAME = HTTP_CONFIG.host;
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const WEBAPP_DIR = join(SERVER_DIR, "..");
const REPO_ROOT = join(WEBAPP_DIR, "..");
const USE_DAEMON_INSTANCE = process.env.SOGGFY_USE_DAEMON_INSTANCE === "1";
const POOL_SIZE = USE_DAEMON_INSTANCE ? 1 : Number.parseInt(process.env.SOGGFY_POOL_SIZE || "1", 10);
const SOGGFY_HIDDEN = process.env.SOGGFY_HIDDEN !== "0";
const MAX_ATTEMPTS = Number.parseInt(process.env.SOGGFY_MAX_ATTEMPTS || "3", 10);
const BASE_DEBUG_PORT = Number.parseInt(process.env.SOGGFY_DEBUG_PORT_BASE || "9223", 10);
const MUTE_OUTPUT = process.env.SOGGFY_MUTE_OUTPUT || "1";
const RUNTIME_DIR = join(SOGGFY_HOME, "runtime");

mkdirSync(OUTPUT_DIR, { recursive: true, mode: 0o700 });
mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });

const jobs = new JobRegistry();
const GLOBAL_METADATA: Record<string, TrackMetadata> = {};

function cachePlaylistTrackMetadata(track: SpotifyPlaylistTrack) {
  GLOBAL_METADATA[track.id] = {
    title: track.name,
    artist: track.artists.join(", ") || "Unknown artist",
    coverUrl: track.imageUrl,
  };
}

async function fetchTrackDuration(trackId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://open.spotify.com/embed/track/${trackId}`);
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/"duration"\s*:\s*(\d+)/);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  } catch (e: any) {
    console.warn(`[Server] Failed to fetch duration for ${trackId}: ${e.message}`);
  }
  return null;
}

async function fetchTrackMetadata(trackId: string): Promise<TrackMetadata | null> {
  try {
    const res = await fetch(`https://open.spotify.com/embed/track/${trackId}`);
    if (!res.ok) return null;
    const html = await res.text();
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">({.*?})<\/script>/);
    if (nextDataMatch?.[1]) {
      const data = JSON.parse(nextDataMatch[1]);
      const entity = data.props?.pageProps?.state?.data?.entity;
      return {
        title: entity?.title || entity?.name,
        artist: entity?.artists?.[0]?.name,
        coverUrl: entity?.visualIdentity?.image?.[0]?.url,
      };
    }
  } catch (e: any) {
    console.warn(`[Server] Failed to fetch metadata for ${trackId}: ${e.message}`);
  }
  return null;
}

function runChecked(command: string, args: string[], label: string) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr || result.stdout || "no output"}`);
  }
}

async function preparePayload() {
  const dylibSource = join(REPO_ROOT, "soggfy-macos/build/libsoggfy.dylib");
  const destDir = join(WORKSPACE_DIR, "PatchedSpotify.app/Contents/MacOS");
  const dylibDest = join(destDir, "libsoggfy.dylib");

  if (!existsSync(dylibSource)) {
    throw new Error(`[Server] libsoggfy.dylib not found at ${dylibSource}. Build with: cd soggfy-macos && cmake --build build`);
  }
  const appBundle = join(WORKSPACE_DIR, "PatchedSpotify.app");
  assertSupportedSpotifyBundle(appBundle);
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  console.log(`[Server] Copying payload dylib into patched app bundle...`);
  copyFileSync(dylibSource, dylibDest);
  console.log(`[Server] Codesigning payload dylib and completed app bundle synchronously...`);
  runChecked("codesign", ["-f", "-s", "-", dylibDest], "codesign libsoggfy.dylib");
  runChecked("codesign", ["-f", "-s", "-", "--deep", appBundle], "codesign patched Spotify bundle");
  runChecked("codesign", ["--verify", "--deep", "--strict", appBundle], "verify patched Spotify bundle");
  console.log(`[Server] Payload dylib is ready: ${dylibDest}`);
}

function parsePlainIpcResponse(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, value: "", raw };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return { ok: true, value: JSON.parse(trimmed), raw }; } catch {}
  }
  return { ok: !trimmed.startsWith("error"), value: trimmed, raw };
}

class JobCancelledError extends Error {
  constructor(job: DownloadJob) {
    super(
      job.error && job.state === "cancelled"
        ? job.error
        : `job ${job.id} was cancelled`
    );
    this.name = "JobCancelledError";
  }
}

class JobPriorityInterruptedError extends Error {
  constructor(job: DownloadJob) {
    super(`job ${job.id} interrupted for priority playback`);
    this.name = "JobPriorityInterruptedError";
  }
}

function assertJobActive(job: DownloadJob) {
  if (job.priorityInterrupted) throw new JobPriorityInterruptedError(job);
  if (job.state === "cancelled") throw new JobCancelledError(job);
}

class SpotifyInstance {
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
      await this.sendIPC(`play spotify:track:${trackId}`);

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

        if (i > 0 && i % 6 === 0 && !trackConfirmed) {
          await this.sendIPC(`play spotify:track:${trackId}`).catch(() => undefined);
          jobs.log(job, "re-requested target track playback");
        }
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
      if (transcode.ok && ffprobeOk(finalMp3Path)) {
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

class SpotifyPoolManager {
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

  async addJob(trackParam: string): Promise<DownloadJob> {
    const trackId = parseTrackId(trackParam);
    if (!trackId) throw new Error("Invalid Spotify track URL, URI, or ID format");

    const reusable = jobs.findReusable(trackId);
    if (reusable) return reusable;

    const job = jobs.create(trackId, GLOBAL_METADATA[trackId]);
    fetchTrackMetadata(trackId).then((meta) => {
      if (meta) {
        GLOBAL_METADATA[trackId] = meta;
        jobs.patch(job, { metadata: meta }, "metadata prefetched");
      }
    }).catch(() => undefined);

    this.queue.enqueue(this.queueEntry(job));
    this.dispatch();
    return job;
  }

  async playNow(trackParam: string): Promise<{ job: DownloadJob; interruptedJobId?: string }> {
    const trackId = parseTrackId(trackParam);
    if (!trackId) throw new Error("Invalid Spotify track URL, URI, or ID format");

    const alreadyActive = this.instances.find((inst) => inst.isBusy && inst.currentTrack === trackId);
    if (alreadyActive?.currentJobId) {
      const activeJob = jobs.get(alreadyActive.currentJobId);
      if (activeJob) return { job: activeJob };
    }

    const existing = jobs.findReusable(trackId);
    if (existing?.state === "completed" && findOutputForTrack(trackId)) return { job: existing };

    const job = existing ?? await this.addJob(trackId);
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

const pool = new SpotifyPoolManager(POOL_SIZE);

async function resolveSpotifyUrl(input: string): Promise<string[]> {
  return resolveSpotifyInput(input);
}

function findOutputForTrack(trackId: string): { path: string; format: "mp3" | "wav" | "ogg" } | null {
  const job = jobs.findByTrack(trackId);
  if (job?.savedPath && existsSync(job.savedPath)) {
    const ext = extname(job.savedPath).slice(1).toLowerCase();
    const inferred = ext === "ogg" ? "ogg" : ext === "wav" ? "wav" : "mp3";
    return { path: job.savedPath, format: job.outputFormat || inferred };
  }
  for (const format of ["mp3", "ogg", "wav"] as const) {
    const path = join(OUTPUT_DIR, `${trackId}.${format}`);
    if (existsSync(path)) return { path, format };
  }
  return null;
}

const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  idleTimeout: 0,
  routes: {
    "/*": index,
    "/api/health": {
      GET: () => jsonResponse({
        ok: true,
        started: pool.started,
        repoRoot: REPO_ROOT,
        outputDir: OUTPUT_DIR,
        poolSize: POOL_SIZE,
        readyInstances: pool.instances.filter((i) => i.isReady).length,
        activeJobs: jobs.all().filter((j) => jobs.isActive(j)).length,
        completedJobs: jobs.all().filter((j) => j.state === "completed").length,
        failedJobs: jobs.all().filter((j) => j.state === "failed").length,
        captureBackend: CAPTURE_BACKEND,
      }),
    },
    "/api/instances": {
      GET: () => jsonResponse(pool.snapshots()),
    },
    "/api/jobs": {
      GET: () => jsonResponse({ jobs: jobs.all(), queue: pool.queue.ids(), instances: pool.snapshots() }),
    },
    "/api/jobs/action": {
      POST: async (req) => {
        try {
          const body = await req.json();
          const jobId = body.jobId;
          const action = body.action;
          if (!jobId || typeof jobId !== "string") return jsonResponse({ error: "Missing jobId" }, { status: 400 });
          if (action === "cancel") return jsonResponse({ job: await pool.cancelJob(jobId, body.reason || "cancelled by user") });
          if (action === "retry") return jsonResponse({ job: await pool.retryJob(jobId) });
          return jsonResponse({ error: "Unsupported action" }, { status: 400 });
        } catch (err: any) {
          return jsonResponse({ error: err.message }, { status: 500 });
        }
      },
    },
    "/api/status": {
      GET: () => jsonResponse(jobs.toLegacyStatus(GLOBAL_METADATA)),
    },
    "/api/search": {
      GET: async (req) => {
        const url = new URL(req.url);
        const query = url.searchParams.get("q");
        if (!query) return jsonResponse({ error: "Missing query" }, { status: 400 });
        try {
          const results = await searchSpotify(query);
          return jsonResponse(groupSearchResults(results));
        } catch (err: any) {
          return jsonResponse({ error: err.message }, { status: 500 });
        }
      },
    },
    "/api/playlist": {
      GET: async (req) => {
        const url = new URL(req.url);
        const input = url.searchParams.get("id");
        if (!input) return jsonResponse({ error: "Missing playlist id" }, { status: 400 });
        const playlistId = parsePlaylistId(input);
        if (!playlistId) return jsonResponse({ error: "Invalid Spotify playlist" }, { status: 400 });
        const offset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
        const limit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
        try {
          const page = await fetchSpotifyPlaylistPage(playlistId, { offset, limit });
          for (const track of page.tracks) cachePlaylistTrackMetadata(track);
          return jsonResponse(page);
        } catch (err: any) {
          const status = /not found/i.test(err.message) ? 404 : 502;
          return jsonResponse({ error: err.message }, { status });
        }
      },
    },
    "/api/track": {
      GET: async (req) => {
        const url = new URL(req.url);
        const input = url.searchParams.get("id");
        const trackId = input ? parseTrackId(input) : null;
        if (!trackId) return jsonResponse({ error: "Invalid Spotify track" }, { status: 400 });
        const [metadata, durationMs] = await Promise.all([fetchTrackMetadata(trackId), fetchTrackDuration(trackId)]);
        if (metadata) GLOBAL_METADATA[trackId] = metadata;
        return jsonResponse({
          id: trackId, uri: `spotify:track:${trackId}`, type: "track",
          name: metadata?.title || trackId, subtitle: metadata?.artist || "Unknown artist",
          imageUrl: metadata?.coverUrl, durationMs: durationMs || undefined,
        });
      },
    },
    "/api/play": {
      POST: async (req) => {
        try {
          const body = await req.json();
          const input = body.trackId || body.url;
          if (!input) return jsonResponse({ success: false, error: "Missing trackId" }, { status: 400 });
          const result = await pool.playNow(input);
          return jsonResponse({ success: true, ...result });
        } catch (err: any) {
          return jsonResponse({ success: false, error: err.message }, { status: 400 });
        }
      },
    },
    "/api/playlist/queue-all": {
      POST: async (req) => {
        try {
          const body = await req.json();
          const input = body.playlistId || body.url || body.id;
          const playlistId = typeof input === "string" ? parsePlaylistId(input) : null;
          if (!playlistId) return jsonResponse({ success: false, error: "Invalid Spotify playlist" }, { status: 400 });
          const playlist = await fetchAllSpotifyPlaylistTracks(playlistId);
          let newlyQueued = 0;
          let existing = 0;
          let skipped = playlist.issues.length;
          const trackIds: string[] = [];
          for (const track of playlist.tracks) {
            cachePlaylistTrackMetadata(track);
            if (!track.playable) { skipped += 1; continue; }
            trackIds.push(track.id);
            if (jobs.findReusable(track.id)) existing += 1;
            else { await pool.addJob(track.id); newlyQueued += 1; }
          }
          return jsonResponse({ success: true, total: playlist.totalCount, newlyQueued, existing, skipped, trackIds });
        } catch (err: any) {
          return jsonResponse({ success: false, error: err.message }, { status: 502 });
        }
      },
    },
    "/api/lyrics": {
      GET: async (req) => {
        const url = new URL(req.url);
        const trackParam = url.searchParams.get("track");
        if (!trackParam) return jsonResponse({ error: "Missing track" }, { status: 400 });
        const trackId = parseTrackId(trackParam);
        if (!trackId) return jsonResponse({ error: "Invalid Spotify track" }, { status: 400 });
        try {
          const lyrics = await fetchSpotifyLyrics(trackId);
          if (!lyrics) return jsonResponse({ available: false, source: "spotify", trackId }, { status: 404 });
          return jsonResponse(lyrics);
        } catch (err: any) {
          return jsonResponse({ error: err.message, source: "spotify", trackId }, { status: 502 });
        }
      },
    },
    "/api/download-all": {
      GET: () => {
        const archive = new ZipArchive({ zlib: { level: 9 } });
        const stream = new ReadableStream({
          start(controller) {
            archive.on("data", (chunk: Buffer) => controller.enqueue(chunk));
            archive.on("end", () => controller.close());
            archive.on("error", (err: Error) => controller.error(err));
            for (const job of jobs.all().filter((j) => j.state === "completed" && j.savedPath && existsSync(j.savedPath))) {
              const ext = job.outputFormat || extname(job.savedPath!).slice(1).toLowerCase() || "bin";
              archive.file(job.savedPath!, { name: displayFileName(job.trackId, job.metadata, ext) });
            }
            archive.finalize();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="soggfy_downloads.zip"',
            ...CORS_HEADERS,
          },
        });
      },
    },
    "/api/file": {
      GET: async (req) => {
        const url = new URL(req.url);
        const trackParam = url.searchParams.get("track");
        if (!trackParam) return new Response("Missing track", { status: 400, headers: CORS_HEADERS });
        const trackId = parseTrackId(trackParam);
        if (!trackId) return new Response("Invalid track", { status: 400, headers: CORS_HEADERS });
        const output = findOutputForTrack(trackId);
        if (!output) return new Response("File not ready", { status: 404, headers: CORS_HEADERS });
        const job = jobs.findByTrack(trackId);
        return serveFileWithRange(req, output.path, displayFileName(trackId, job?.metadata, output.format));
      },
    },
    "/api/stream": {
      GET: async (req) => {
        const url = new URL(req.url);
        const trackParam = url.searchParams.get("track");
        if (!trackParam) return new Response("Missing track", { status: 400, headers: CORS_HEADERS });
        const resolvedTrackIds = await resolveSpotifyInput(trackParam);
        const trackId = resolvedTrackIds[0];
        if (!trackId) return new Response("Invalid track", { status: 400, headers: CORS_HEADERS });

        const output = findOutputForTrack(trackId);
        if (output) return serveFileWithRange(req, output.path);

        const existing = jobs.findReusable(trackId);
        if (!existing) {
          pool.addJob(trackId).catch((err) => console.error(`[Server] stream-triggered job failed for ${trackId}:`, err));
        }
        return jsonResponse({ queued: true, trackId, message: "Track is queued/capturing; retry stream when status is completed." }, { status: 202 });
      },
    },
    "/api/download": {
      POST: async (req) => {
        try {
          const body = await req.json();
          const input = body.url || body.trackId;
          if (!input) return jsonResponse({ success: false, error: "Missing 'url' or 'trackId'" }, { status: 400 });
          const trackIds = await resolveSpotifyUrl(input);
          if (trackIds.length === 0) return jsonResponse({ success: false, error: "Could not extract any valid tracks from the input URL." }, { status: 400 });

          for (const id of trackIds) {
            pool.addJob(id).catch((err) => console.error(`[Server] Background job failed for ${id}:`, err));
          }
          return jsonResponse({ success: true, queued: true, count: trackIds.length, trackIds });
        } catch (err: any) {
          return jsonResponse({ success: false, error: err.message }, { status: 500 });
        }
      },
    },
  },
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response("", { headers: CORS_HEADERS });
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
});

console.log(`\n=============================================================`);
console.log(`Soggfy supervised API server running at http://${HOSTNAME}:${PORT}`);
console.log(`=============================================================`);
console.log(`- Web UI: http://${HOSTNAME}:${PORT}/`);
console.log(`- Repo root: ${REPO_ROOT}`);
console.log(`- Runtime: ${USE_DAEMON_INSTANCE ? "daemon-owned Spotify instance" : `standalone pool (${POOL_SIZE})`}`);
console.log(`- Capture backend: ${CAPTURE_BACKEND}`);
console.log(`- Health: http://${HOSTNAME}:${PORT}/api/health`);
console.log(`=============================================================\n`);

pool.start().catch((err) => console.error("[Server] Error initializing Spotify pool:", err));

process.on("SIGINT", async () => {
  console.log("\n[Server] Shutting down...");
  await pool.stop();
  server.stop(true);
  process.exit(0);
});
