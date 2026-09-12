import type { DownloadJob } from "./models";

export function playerStatus(job: DownloadJob, playing: boolean, buffering: boolean): string {
  if (job.state === "completed") return "Downloaded";
  if (job.state === "failed") return "Playback failed";
  if (job.state === "cancelled") return "Cancelled";
  if (buffering) return "Buffering";
  if (job.state === "queued") return "Queued";
  if (job.state === "assigned") return "Assigned";
  if (job.state === "starting") return "Starting";
  if (job.state === "finalizing") return "Finalizing";
  if (job.state === "transcoding") return "Transcoding";
  return playing ? "Playing · downloading" : "Paused · downloading";
}

export function seekLimit(
  job: DownloadJob,
  mediaDuration: number,
  bufferedEnd = 0,
): number {
  if (job.state === "completed") return Number.isFinite(mediaDuration) ? Math.max(0, mediaDuration) : 0;
  if (!Number.isFinite(bufferedEnd)) return 0;
  return Math.max(0, Math.min(bufferedEnd, Number.isFinite(mediaDuration) ? mediaDuration : bufferedEnd));
}
