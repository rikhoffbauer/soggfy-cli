import { IconLoader2, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchResults } from "./SearchResults";
import type { SearchSession, SearchTab } from "./workspace-model";

interface SearchPanelProps {
  query: string;
  session: SearchSession;
  error: string | null;
  onQueryChange: (value: string) => void;
  onSubmit: (query: string) => void;
  onTabChange: (tab: SearchTab) => void;
  onLoadMore: (tab: SearchTab) => void;
  onPlayTrack: (trackId: string) => void;
  onQueueTrack: (trackId: string) => void;
  onOpenAlbum: (albumId: string) => void;
  onOpenPlaylist: (playlistId: string) => void;
  detail?: React.ReactNode;
}

const TABS: Array<{ value: SearchTab; label: string }> = [
  { value: "track", label: "Tracks" },
  { value: "album", label: "Albums" },
  { value: "playlist", label: "Playlists" },
  { value: "artist", label: "Artists" },
];

export function SearchPanel(props: SearchPanelProps) {
  const { query, session, error, onQueryChange, onSubmit, onTabChange, onLoadMore, onPlayTrack, onQueueTrack, onOpenAlbum, onOpenPlaylist, detail } = props;
  const active = session.tabs[session.activeTab];
  const searching = active.loading && !active.loaded;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-white/[0.06] pb-4">
        <div className="mb-4">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Find music</h1>
          <p className="mt-1 text-sm text-white/42">Search Spotify or paste a track, album, or playlist URL.</p>
        </div>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (query.trim()) onSubmit(query.trim()); }}>
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-white/35" />
            <Input
              autoFocus
              aria-label="Search Spotify or paste a Spotify URL"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search Spotify"
              className="h-12 rounded-xl border-white/10 bg-white/[0.055] pl-11 pr-4 text-base text-white placeholder:text-white/28 focus-visible:border-primary/40 focus-visible:ring-primary/25"
            />
          </div>
          <Button type="submit" disabled={!query.trim() || searching} className="h-12 rounded-xl px-5 font-semibold">
            {searching ? <IconLoader2 className="size-4 animate-spin" /> : <IconSearch className="size-4" />}
            <span className="hidden sm:inline">Search</span>
          </Button>
        </form>
        {error ? <div role="alert" className="mt-3 rounded-lg border border-red-400/20 bg-red-500/8 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        <div className="mt-4 flex items-end gap-1 overflow-x-auto" role="tablist" aria-label="Search result type">
          {TABS.map((item) => {
            const tab = session.tabs[item.value];
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={session.activeTab === item.value}
                onClick={() => onTabChange(item.value)}
                className={`border-b-2 px-3 py-2 text-sm font-semibold transition focus-visible:outline-none ${session.activeTab === item.value ? "border-primary text-white" : "border-transparent text-white/42 hover:text-white/75"}`}
              >
                {item.label}{tab.loaded && tab.items.length ? <span className="ml-1.5 text-[11px] tabular-nums text-white/30">{tab.items.length}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-5">
        {detail ?? (session.query ? (
          <SearchResults
            tab={session.activeTab}
            items={active.items}
            loaded={active.loaded}
            loading={active.loading}
            nextOffset={active.nextOffset}
            onLoadMore={() => onLoadMore(session.activeTab)}
            onPlayTrack={onPlayTrack}
            onQueueTrack={onQueueTrack}
            onOpenAlbum={onOpenAlbum}
            onOpenPlaylist={onOpenPlaylist}
          />
        ) : (
          <div className="grid min-h-72 place-items-center border border-dashed border-white/8 text-center text-sm text-white/30">Search Spotify to browse tracks, albums, playlists, or artists.</div>
        ))}
      </div>
    </section>
  );
}
