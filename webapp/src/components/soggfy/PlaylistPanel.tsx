import {
  IconDownload,
  IconLoader2,
  IconMusic,
  IconPlayerPlay,
  IconPlaylistAdd,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { DownloadJob, PlaylistIssue, PlaylistPage, PlaylistTrack } from "./models";

interface PlaylistPanelProps {
  page: PlaylistPage;
  jobsByTrack: Map<string, DownloadJob>;
  loading: boolean;
  queueAllLoading: boolean;
  onPlay: (trackId: string) => void;
  onQueue: (trackId: string) => void;
  onQueueAll: () => void;
  onLoadMore: () => void;
}

type Row =
  | { kind: "track"; index: number; track: PlaylistTrack }
  | { kind: "issue"; index: number; issue: PlaylistIssue };

function orderedRows(page: PlaylistPage): Row[] {
  return [
    ...page.tracks.map((track): Row => ({ kind: "track", index: track.sourceIndex, track })),
    ...page.issues.map((issue): Row => ({ kind: "issue", index: issue.index, issue })),
  ].sort((a, b) => a.index - b.index);
}

function stateLabel(job?: DownloadJob) {
  if (!job) return null;
  if (job.state === "completed") return "Downloaded";
  if (job.state === "failed" || job.state === "cancelled") return job.state;
  if (job.state === "capturing" || job.state === "playing") return "Downloading";
  return "Queued";
}

export function PlaylistPanel(props: PlaylistPanelProps) {
  const { page, jobsByTrack, loading, queueAllLoading, onPlay, onQueue, onQueueAll, onLoadMore } = props;
  const rows = orderedRows(page);

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]">
      <div className="flex flex-col gap-4 border-b border-white/[0.06] p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.06] text-white/25">
            {page.playlist.imageUrl ? (
              <img src={page.playlist.imageUrl} alt="" className="size-full object-cover" />
            ) : <IconMusic className="size-6" />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-white">{page.playlist.name}</div>
            <div className="mt-1 text-xs text-white/40">
              {page.playlist.owner} · {page.totalCount} items
            </div>
            {page.playlist.description ? (
              <div className="mt-1 line-clamp-2 text-xs text-white/32">{page.playlist.description}</div>
            ) : null}
          </div>
        </div>
        <Button onClick={onQueueAll} disabled={queueAllLoading} className="shrink-0 rounded-lg">
          {queueAllLoading ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlaylistAdd className="size-4" />}
          Queue all
        </Button>
      </div>

      <div>
        {rows.map((row) => row.kind === "track" ? (
          <PlaylistTrackRow
            key={`${row.index}:${row.track.id}`}
            track={row.track}
            job={jobsByTrack.get(row.track.id)}
            onPlay={onPlay}
            onQueue={onQueue}
          />
        ) : (
          <div key={`${row.index}:${row.issue.reason}`} className="flex min-h-14 items-center gap-3 border-b border-white/[0.05] px-4 py-2 text-xs text-white/28 last:border-b-0">
            <div className="w-8 text-right tabular-nums">{row.index + 1}</div>
            <div className="flex-1">Unavailable playlist item</div>
            <Button size="sm" variant="ghost" disabled>Unavailable</Button>
          </div>
        ))}
      </div>

      {page.nextOffset !== null ? (
        <div className="border-t border-white/[0.06] p-3 text-center">
          <Button variant="secondary" onClick={onLoadMore} disabled={loading} className="rounded-lg">
            {loading ? <IconLoader2 className="size-4 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PlaylistTrackRow(props: {
  track: PlaylistTrack;
  job?: DownloadJob;
  onPlay: (trackId: string) => void;
  onQueue: (trackId: string) => void;
}) {
  const { track, job, onPlay, onQueue } = props;
  const label = stateLabel(job);
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-white/[0.05] px-3 py-2.5 last:border-b-0 hover:bg-white/[0.03] sm:px-4">
      <div className="w-7 shrink-0 text-right text-xs tabular-nums text-white/25">{track.sourceIndex + 1}</div>
      <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.06] text-white/25">
        {track.imageUrl ? <img src={track.imageUrl} alt="" className="size-full object-cover" loading="lazy" /> : <IconMusic className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white/88">{track.name}</div>
        <div className="mt-0.5 flex gap-2 truncate text-xs text-white/36">
          <span className="truncate">{track.artists.join(", ") || "Unknown artist"}</span>
          {label ? <span className="shrink-0 text-primary/75">· {label}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={() => onPlay(track.id)} disabled={!track.playable} className="rounded-lg">
          <IconPlayerPlay className="size-4" /><span className="hidden sm:inline">Play</span>
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onQueue(track.id)} disabled={!track.playable || Boolean(job && job.state !== "failed" && job.state !== "cancelled")} className="rounded-lg">
          <IconDownload className="size-4" /><span className="hidden sm:inline">Queue</span>
        </Button>
      </div>
    </div>
  );
}
