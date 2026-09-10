import {
  IconDisc,
  IconDownload,
  IconExternalLink,
  IconMusic,
  IconPlayerPlay,
  IconPlaylist,
  IconUser,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { SearchResult } from "./models";
import type { SearchTab } from "./workspace-model";

interface SearchResultsProps {
  tab: SearchTab;
  items: SearchResult[];
  loaded: boolean;
  loading: boolean;
  nextOffset: number | null;
  onLoadMore: () => void;
  onPlayTrack: (trackId: string) => void;
  onQueueTrack: (trackId: string) => void;
  onOpenAlbum: (album: SearchResult) => void;
  onOpenPlaylist: (playlistId: string) => void;
}

export function SearchResults(props: SearchResultsProps) {
  const { tab, items, loaded, loading, nextOffset, onLoadMore } = props;

  if (!loaded && loading) {
    return <div className="grid min-h-64 place-items-center text-sm text-white/35">Loading results…</div>;
  }
  if (!loaded) {
    return <div className="grid min-h-64 place-items-center text-sm text-white/35">Select a category to search.</div>;
  }
  if (!items.length) {
    return <div className="grid min-h-64 place-items-center text-sm text-white/35">No {tabLabel(tab).toLowerCase()} found.</div>;
  }

  return (
    <div className="min-h-0">
      {tab === "track" ? <TrackResults {...props} /> : <GridResults {...props} />}
      {nextOffset !== null ? (
        <div className="flex justify-center py-6">
          <Button type="button" variant="secondary" disabled={loading} onClick={onLoadMore} className="min-w-32">
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TrackResults({ items, onPlayTrack, onQueueTrack }: SearchResultsProps) {
  return (
    <div className="overflow-hidden border-y border-white/[0.06]">
      {items.map((result, index) => (
        <div key={result.id} className="group grid min-h-14 grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.05] px-2 py-1.5 last:border-b-0 hover:bg-white/[0.035] sm:px-3">
          <span className="text-right text-xs tabular-nums text-white/22">{index + 1}</span>
          <ResultImage result={result} compact />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white/90">{result.name}</div>
            <div className="truncate text-xs text-white/38">{result.subtitle}</div>
          </div>
          <div className="flex items-center gap-1">
            <IconAction label="Play" onClick={() => onPlayTrack(result.id)}><IconPlayerPlay /></IconAction>
            <IconAction label="Queue" onClick={() => onQueueTrack(result.id)}><IconDownload /></IconAction>
          </div>
        </div>
      ))}
    </div>
  );
}

function GridResults(props: SearchResultsProps) {
  const { tab, items, onOpenAlbum, onOpenPlaylist } = props;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 min-[1900px]:grid-cols-7">
      {items.map((result) => {
        const open = tab === "album"
          ? () => onOpenAlbum(result)
          : tab === "playlist"
            ? () => onOpenPlaylist(result.id)
            : () => window.open(`https://open.spotify.com/artist/${result.id}`, "_blank", "noopener,noreferrer");
        return (
          <button key={result.id} type="button" onClick={open} className="group min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
            <ResultImage result={result} />
            <div className="mt-2 truncate text-sm font-semibold text-white/88 group-hover:text-white">{result.name}</div>
            <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-white/36">
              <span className="truncate">{result.subtitle}</span>
              {tab === "artist" ? <IconExternalLink className="size-3 shrink-0" /> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ResultImage({ result, compact = false }: { result: SearchResult; compact?: boolean }) {
  const Icon = result.type === "artist" ? IconUser : result.type === "playlist" ? IconPlaylist : result.type === "album" ? IconDisc : IconMusic;
  const shape = result.type === "artist" ? "rounded-full" : compact ? "rounded" : "rounded-lg";
  const size = compact ? "size-10" : "aspect-square w-full";
  return (
    <div className={`${size} ${shape} grid shrink-0 place-items-center overflow-hidden bg-white/[0.055] text-white/20`}>
      {result.imageUrl ? <img src={result.imageUrl} alt="" className="size-full object-cover transition duration-200 group-hover:scale-[1.02]" loading="lazy" /> : <Icon className={compact ? "size-4" : "size-8"} />}
    </div>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded-md p-2 text-white/38 hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 [&>svg]:size-4">
      {children}
    </button>
  );
}

function tabLabel(tab: SearchTab) {
  return tab === "track" ? "Tracks" : tab === "album" ? "Albums" : tab === "playlist" ? "Playlists" : "Artists";
}
