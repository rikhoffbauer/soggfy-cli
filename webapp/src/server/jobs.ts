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
export class JobRegistry {
  private jobs = new Map<string, DownloadJob>();
  private byTrack = new Map<string, string>();
  private jobSeq = 0;

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
    this.log(job, "queued");
    return job;
  }

  all(): DownloadJob[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    return job;
  }

  patch(job: DownloadJob, patch: Partial<DownloadJob>, logMessage?: string): DownloadJob {
    Object.assign(job, patch);
    job.legacyStatus = legacyForState(job.state);
    job.updatedAt = nowIso();
    if (logMessage) this.log(job, logMessage);
    return job;
  }

  fail(job: DownloadJob, error: unknown): DownloadJob {
    const message = error instanceof Error ? error.message : String(error);
    return this.transition(job, "failed", { error: message });
  }

  cancel(job: DownloadJob, reason = "cancelled by user"): DownloadJob {
    return this.transition(job, "cancelled", { error: reason });
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
