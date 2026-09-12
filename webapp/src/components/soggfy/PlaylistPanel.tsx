import { IconArrowLeft, IconLoader2, IconMusic, IconPlaylistAdd } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { DownloadJob, PlaylistIssue, PlaylistPage, PlaylistTrack } from "./models";
import { TrackListRow } from "./TrackListRow";

interface PlaylistPanelProps {
  page: PlaylistPage;
  jobsByTrack: Map<string, DownloadJob>;
  loading: boolean;
  queueAllLoading: boolean;
  onBack: () => void;
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

export function PlaylistPanel({ page, jobsByTrack, loading, queueAllLoading, onBack, onPlay, onQueue, onQueueAll, onLoadMore }: PlaylistPanelProps) {
  const rows = orderedRows(page);
  return (
    <section className="min-h-0">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/45 hover:text-white">
        <IconArrowLeft className="size-4" /> Back to results
      </button>
      <div className="flex flex-col gap-5 border-b border-white/[0.06] pb-5 sm:flex-row sm:items-end">
        <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.06] text-white/20 sm:size-36">
          {page.playlist.imageUrl ? <img src={page.playlist.imageUrl} alt="" className="size-full object-cover" /> : <IconMusic className="size-10" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-white/30">Playlist</div>
          <h2 className="mt-1 truncate text-2xl font-bold text-white sm:text-3xl">{page.playlist.name}</h2>
          <div className="mt-2 text-sm text-white/45">{page.playlist.owner} · {page.totalCount} items</div>
          {page.playlist.description ? <div className="mt-1 line-clamp-2 max-w-3xl text-xs text-white/32">{page.playlist.description}</div> : null}
        </div>
        <Button onClick={onQueueAll} disabled={queueAllLoading} className="shrink-0">
          {queueAllLoading ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlaylistAdd className="size-4" />} Queue all
        </Button>
      </div>
      <div className="pt-3">
        {rows.map((row) => row.kind === "track" ? (
          <TrackListRow key={`${row.index}:${row.track.id}`} track={row.track} job={jobsByTrack.get(row.track.id)} onPlay={onPlay} onQueue={onQueue} />
        ) : (
          <div key={`${row.index}:${row.issue.reason}`} className="grid min-h-14 grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.05] px-2 text-xs text-white/28 sm:px-3">
            <div className="text-right tabular-nums">{row.index + 1}</div><div aria-hidden="true" /><div>Unavailable playlist item</div><span>Unavailable</span>
          </div>
        ))}
      </div>
      {page.nextOffset !== null ? (
        <div className="flex justify-center py-5">
          <Button variant="secondary" onClick={onLoadMore} disabled={loading}>{loading ? <IconLoader2 className="size-4 animate-spin" /> : null} Load more</Button>
        </div>
      ) : null}
    </section>
  );
}
