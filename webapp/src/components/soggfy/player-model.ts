import type { DownloadJob } from "./models";

export function playerStatus(job: DownloadJob, playing: boolean, buffering: boolean): string {
  if (buffering && job.state !== "completed") return "Buffering";
  if (job.state === "completed") return "Downloaded";
  if (job.state === "failed") return "Playback failed";
  if (job.state === "cancelled") return "Cancelled";
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
