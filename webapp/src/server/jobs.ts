import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, resolve, sep } from "path";

export type DownloadState =
  | "queued"
  | "assigned"
  | "starting"
  | "playing"
  | "capturing"
  | "finalizing"
  | "transcoding"
  | "completed"
  | "failed"
  | "cancelled";

export type LegacyDownloadState = "pending" | "downloading" | "completed" | "failed";

export interface TrackMetadata {
  title?: string;
  artist?: string;
  coverUrl?: string;
}

export interface OutputValidation {
  ok?: boolean;
  container?: string;
  decodedSignalOk?: boolean;
  riffHeader?: boolean;
  waveHeader?: boolean;
  fmtChunk?: boolean;
  dataChunk?: boolean;
  headerDataBytes?: number;
  actualDataBytes?: number;
  durationMs?: number;
  rms?: number;
  peak?: number;
  silenceRatio?: number;
  ffprobeOk?: boolean;
  warnings: string[];
}

export interface DownloadJob {
  id: string;
  trackId: string;
  state: DownloadState;
  legacyStatus: LegacyDownloadState;
  instanceId?: number;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  bytesCaptured: number;
  expectedBytes?: number;
  durationMs?: number;
  capturePath?: string;
  wavPath?: string;
  oggPath?: string;
  mp3Path?: string;
  savedPath?: string;
  outputFormat?: "wav" | "ogg" | "mp3";
  sizeBytes?: number;
  error?: string;
  metadata?: TrackMetadata;
  validation?: OutputValidation;
  priorityInterrupted?: boolean;
  logs: string[];
}

export interface QueuedJob {
  job: DownloadJob;
  resolve: (value: DownloadJob) => void;
  reject: (error: Error) => void;
}

const ACTIVE_STATES: DownloadState[] = [
  "queued",
  "assigned",
  "starting",
  "playing",
  "capturing",
  "finalizing",
  "transcoding",
];

const TERMINAL_STATES: DownloadState[] = ["completed", "failed", "cancelled"];

function nowIso() {
  return new Date().toISOString();
}

function legacyForState(state: DownloadState): LegacyDownloadState {
  switch (state) {
    case "queued":
    case "assigned":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "downloading";
  }
}
export interface JobRegistryOptions {
  maxTerminalJobs?: number;
}

export class JobRegistry {
  private jobs = new Map<string, DownloadJob>();
  private byTrack = new Map<string, string>();
  private jobSeq = 0;
  private revisionValue = 0;
  private maxTerminalJobs: number;

  constructor(options: JobRegistryOptions = {}) {
    this.maxTerminalJobs = Math.max(1, options.maxTerminalJobs ?? 500);
  }

  create(trackId: string, metadata?: TrackMetadata): DownloadJob {
    const existing = this.findReusable(trackId);
    if (existing) return existing;

    const id = `${Date.now().toString(36)}-${(++this.jobSeq).toString(36)}-${trackId}`;
    const job: DownloadJob = {
      id,
      trackId,
      state: "queued",
      legacyStatus: "pending",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      attempts: 0,
      bytesCaptured: 0,
      metadata,
      logs: [],
    };
    this.jobs.set(id, job);
    this.byTrack.set(trackId, id);
    this.touch();
    this.log(job, "queued");
    return job;
  }

  all(): DownloadJob[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get revision(): number {
    return this.revisionValue;
  }

  private touch(): void {
    this.revisionValue += 1;
  }

  get(jobId: string): DownloadJob | undefined {
    return this.jobs.get(jobId);
  }

  findByTrack(trackId: string): DownloadJob | undefined {
    const id = this.byTrack.get(trackId);
    return id ? this.jobs.get(id) : undefined;
  }

  findReusable(trackId: string): DownloadJob | undefined {
    const existing = this.findByTrack(trackId);
    if (!existing) return undefined;
    if (existing.state === "failed" || existing.state === "cancelled") return undefined;
    return existing;
  }

  isActive(job: DownloadJob): boolean {
    return ACTIVE_STATES.includes(job.state);
  }

  isTerminal(job: DownloadJob): boolean {
    return TERMINAL_STATES.includes(job.state);
  }

  transition(job: DownloadJob, state: DownloadState, patch: Partial<DownloadJob> = {}): DownloadJob {
    Object.assign(job, patch);
    job.state = state;
    job.legacyStatus = legacyForState(state);
    job.updatedAt = nowIso();
    if (state === "failed" || state === "cancelled") {
      const mapped = this.byTrack.get(job.trackId);
      if (mapped === job.id) this.byTrack.delete(job.trackId);
    } else if (state !== "completed") {
      this.byTrack.set(job.trackId, job.id);
    }
    this.log(job, `state=${state}`);
    this.touch();
    this.pruneTerminalHistory();
    return job;
  }

  patch(job: DownloadJob, patch: Partial<DownloadJob>, logMessage?: string): DownloadJob {
    Object.assign(job, patch);
    job.legacyStatus = legacyForState(job.state);
    job.updatedAt = nowIso();
    if (logMessage) this.log(job, logMessage);
    this.touch();
    return job;
  }

  fail(job: DownloadJob, error: unknown): DownloadJob {
    const message = error instanceof Error ? error.message : String(error);
    return this.transition(job, "failed", { error: message });
  }

  cancel(job: DownloadJob, reason = "cancelled by user"): DownloadJob {
    return this.transition(job, "cancelled", { error: reason });
  }

  requeueAfterPriorityInterruption(job: DownloadJob): DownloadJob {
    return this.transition(job, "queued", {
      attempts: Math.max(0, job.attempts - 1),
      bytesCaptured: 0,
      capturePath: undefined,
      wavPath: undefined,
      oggPath: undefined,
      instanceId: undefined,
      error: undefined,
      validation: undefined,
      priorityInterrupted: undefined,
    });
  }

  complete(job: DownloadJob, patch: Partial<DownloadJob> = {}): DownloadJob {
    return this.transition(job, "completed", patch);
  }

  log(job: DownloadJob, message: string): void {
    const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
    job.logs.push(entry);
    if (job.logs.length > 80) job.logs.shift();
    job.updatedAt = nowIso();
  }

  hydrateFromOutputDir(outputDir: string): number {
    const root = resolve(outputDir);
    const prefix = `${root}${sep}`;
    let loaded = 0;
    let entries: string[] = [];
    try { entries = readdirSync(root).filter((name) => /\.(?:mp3|ogg|wav)\.json$/i.test(name)); }
    catch { return 0; }

    const sidecars = entries.map((name) => join(root, name)).sort((a, b) => {
      try { return statSync(a).mtimeMs - statSync(b).mtimeMs; } catch { return 0; }
    });
    for (const sidecarPath of sidecars) {
      try {
        const payload = JSON.parse(readFileSync(sidecarPath, "utf8"));
        if (!payload || typeof payload.trackId !== "string") continue;
        const audioPath = sidecarPath.slice(0, -".json".length);
        const resolvedAudio = resolve(audioPath);
        if (!resolvedAudio.startsWith(prefix) || !existsSync(resolvedAudio)) continue;
        const format = extname(audioPath).slice(1).toLowerCase();
        if (!["mp3", "ogg", "wav"].includes(format)) continue;
        const when = typeof payload.completedAt === "string" ? payload.completedAt : new Date(statSync(audioPath).mtimeMs).toISOString();
        const id = typeof payload.jobId === "string" && payload.jobId ? payload.jobId : `persisted-${payload.trackId}-${when}`;
        const job: DownloadJob = {
          id, trackId: payload.trackId, state: "completed", legacyStatus: "completed",
          createdAt: when, updatedAt: when, attempts: Number(payload.attempts || 0),
          bytesCaptured: Number(payload.bytesCaptured || 0), expectedBytes: payload.expectedBytes,
          durationMs: payload.durationMs, savedPath: resolvedAudio, sizeBytes: statSync(resolvedAudio).size,
          outputFormat: format as "mp3" | "ogg" | "wav", metadata: payload.metadata,
          validation: payload.validation, logs: [`[persisted] restored from ${sidecarPath}`],
        };
        this.jobs.set(id, job);
        this.byTrack.set(job.trackId, id);
        loaded += 1;
      } catch {}
    }
    if (loaded > 0) this.touch();
    this.pruneTerminalHistory();
    return loaded;
  }

  private pruneTerminalHistory(): void {
    const terminal = [...this.jobs.values()]
      .filter((job) => this.isTerminal(job))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const excess = Math.max(0, terminal.length - this.maxTerminalJobs);
    for (const job of terminal.slice(0, excess)) {
      this.jobs.delete(job.id);
      if (this.byTrack.get(job.trackId) === job.id) this.byTrack.delete(job.trackId);
      this.touch();
    }
  }

  toLegacyStatus(extraMetadata: Record<string, TrackMetadata> = {}): Record<string, any> {
    const out: Record<string, any> = {};
    for (const job of this.all()) {
      const metadata = { ...(extraMetadata[job.trackId] || {}), ...(job.metadata || {}) };
      out[job.trackId] = {
        id: job.trackId,
        trackId: job.trackId,
        status: job.legacyStatus,
        state: job.state,
        jobId: job.id,
        instanceId: job.instanceId,
        bytesCaptured: job.bytesCaptured,
        expectedBytes: job.expectedBytes,
        durationMs: job.durationMs,
        outputFormat: job.outputFormat,
        sizeBytes: job.sizeBytes,
        error: job.error,
        ...metadata,
      };
    }
    return out;
  }
}
