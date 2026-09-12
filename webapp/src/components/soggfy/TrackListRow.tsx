import { IconDownload, IconMusic, IconPlayerPlay } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { DownloadJob, PlaylistTrack } from "./models";

interface TrackListRowProps {
  track: PlaylistTrack;
  job?: DownloadJob;
  onPlay: (trackId: string) => void;
  onQueue: (trackId: string) => void;
}

function stateLabel(job?: DownloadJob) {
  if (!job) return null;
  if (job.state === "completed") return "Downloaded";
  if (job.state === "failed") return "Failed";
  if (job.state === "cancelled") return "Cancelled";
  if (job.state === "capturing" || job.state === "playing") return "Downloading";
  if (job.state === "transcoding" || job.state === "finalizing") return "Processing";
  return "Queued";
}

export function TrackListRow({ track, job, onPlay, onQueue }: TrackListRowProps) {
  const label = stateLabel(job);
  return (
    <div className="grid min-h-14 grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.05] px-2 py-1.5 last:border-b-0 hover:bg-white/[0.03] sm:px-3">
      <div className="text-right text-xs tabular-nums text-white/25">{track.sourceIndex + 1}</div>
      <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded bg-white/[0.06] text-white/25">
        {track.imageUrl ? <img src={track.imageUrl} alt="" className="size-full object-cover" loading="lazy" /> : <IconMusic className="size-4" />}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white/88">{track.name}</div>
        <div className="flex gap-2 truncate text-xs text-white/36">
          <span className="truncate">{track.artists.join(", ") || "Unknown artist"}</span>
          {track.durationMs ? <span className="shrink-0">· {formatDuration(track.durationMs)}</span> : null}
          {label ? <span className="shrink-0 text-primary/75">· {label}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => onPlay(track.id)} disabled={!track.playable} className="h-8 px-2.5">
          <IconPlayerPlay className="size-4" /><span className="hidden sm:inline">Play</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onQueue(track.id)} disabled={!track.playable || Boolean(job && job.state !== "failed" && job.state !== "cancelled")} className="h-8 px-2.5">
          <IconDownload className="size-4" /><span className="hidden sm:inline">Queue</span>
        </Button>
      </div>
    </div>
  );
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
