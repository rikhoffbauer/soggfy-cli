export type DownloadState =
  | "queued" | "assigned" | "starting" | "playing" | "capturing"
  | "finalizing" | "transcoding" | "completed" | "failed" | "cancelled";

export interface TrackMetadata {
  title?: string;
  artist?: string;
  coverUrl?: string;
}

export interface OutputValidation {
  warnings: string[];
  rms?: number;
  peak?: number;
  silenceRatio?: number;
  ffprobeOk?: boolean;
  actualDataBytes?: number;
  durationMs?: number;
  container?: string;
  decodedSignalOk?: boolean;
}

export interface DownloadJob {
  id: string;
  trackId: string;
  state: DownloadState;
  legacyStatus?: "pending" | "downloading" | "completed" | "failed";
  instanceId?: number;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  bytesCaptured: number;
  expectedBytes?: number;
  durationMs?: number;
  outputFormat?: "wav" | "ogg" | "mp3";
  sizeBytes?: number;
  error?: string;
  title?: string;
  artist?: string;
  coverUrl?: string;
  metadata?: TrackMetadata;
  validation?: OutputValidation;
  priorityInterrupted?: boolean;
  logs: string[];
}

export interface InstanceSnapshot {
  id: number;
  socketPath: string;
  savePath: string;
  profileDir: string;
  debugPort: number;
  isReady: boolean;
  isBusy: boolean;
  currentTrack: string | null;
  currentJobId: string | null;
  statusText: string;
  lastHeartbeatAt?: string;
  lastError?: string;
  logs: string[];
}

export interface JobsSnapshot {
  jobs: DownloadJob[];
  queue: string[];
  instances: InstanceSnapshot[];
}
export interface HealthSnapshot {
  ok: boolean;
  started: boolean;
  repoRoot: string;
  outputDir: string;
  poolSize: number;
  readyInstances: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  captureBackend?: string;
}

export interface LogSource {
  id: string;
  label: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  category: "daemon" | "historical" | "runtime" | "spotify" | "payload";
}

export interface LogTailSnapshot {
  source: LogSource;
  lines: string[];
  truncated: boolean;
}

export type SearchResultType = "track" | "artist" | "playlist";

export interface SearchResult {
  id: string;
  uri: string;
  type: SearchResultType;
  name: string;
  subtitle: string;
  imageUrl?: string;
}

export interface PlaylistTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  imageUrl?: string;
  durationMs?: number;
  playable: boolean;
  sourceIndex: number;
}

export interface PlaylistIssue {
  index: number;
  reason: "unavailable" | "non-track" | "malformed";
}

export interface PlaylistDetail {
  id: string;
  uri: string;
  name: string;
  owner: string;
  description?: string;
  imageUrl?: string;
}

export interface PlaylistPage {
  playlist: PlaylistDetail;
  tracks: PlaylistTrack[];
  issues: PlaylistIssue[];
  offset: number;
  limit: number;
  totalCount: number;
  nextOffset: number | null;
}
