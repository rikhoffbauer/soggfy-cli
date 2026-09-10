import { IconArrowLeft, IconDisc, IconLoader2, IconPlaylistAdd } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { AlbumPage, DownloadJob } from "./models";
import { TrackListRow } from "./TrackListRow";

interface AlbumPanelProps {
  page: AlbumPage;
  jobsByTrack: Map<string, DownloadJob>;
  loading: boolean;
  queueAllLoading: boolean;
  onBack: () => void;
  onPlay: (trackId: string) => void;
  onQueue: (trackId: string) => void;
  onQueueAll: () => void;
  onLoadMore: () => void;
}

export function AlbumPanel({ page, jobsByTrack, loading, queueAllLoading, onBack, onPlay, onQueue, onQueueAll, onLoadMore }: AlbumPanelProps) {
  return (
    <section className="min-h-0">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-medium text-white/45 hover:text-white">
        <IconArrowLeft className="size-4" /> Back to results
      </button>
      <div className="flex flex-col gap-5 border-b border-white/[0.06] pb-5 sm:flex-row sm:items-end">
        <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.06] text-white/20 sm:size-36">
          {page.album.imageUrl ? <img src={page.album.imageUrl} alt="" className="size-full object-cover" /> : <IconDisc className="size-10" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-white/30">Album</div>
          <h2 className="mt-1 truncate text-2xl font-bold text-white sm:text-3xl">{page.album.name}</h2>
          <div className="mt-2 text-sm text-white/45">{page.album.artists.join(", ") || "Unknown artist"} · {page.totalCount} tracks</div>
        </div>
        <Button onClick={onQueueAll} disabled={queueAllLoading} className="shrink-0">
          {queueAllLoading ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlaylistAdd className="size-4" />} Queue all
        </Button>
      </div>
      <div className="pt-3">
        {page.tracks.map((track) => <TrackListRow key={`${track.sourceIndex}:${track.id}`} track={track} job={jobsByTrack.get(track.id)} onPlay={onPlay} onQueue={onQueue} />)}
      </div>
      {page.nextOffset !== null ? (
        <div className="flex justify-center py-5">
          <Button variant="secondary" onClick={onLoadMore} disabled={loading}>{loading ? <IconLoader2 className="size-4 animate-spin" /> : null} Load more</Button>
        </div>
      ) : null}
    </section>
  );
}
