import { useMemo, useState } from "react";
import {
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconMusic,
  IconPlaylist,
  IconSearch,
  IconUser,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SearchResult } from "./models";
import {
  downloadInputForSearchResult,
  filterSearchResults,
  type SearchFilter,
} from "./workspace-model";

interface SearchPanelProps {
  query: string;
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  onQueryChange: (value: string) => void;
  onSubmit: (query: string) => void;
  onQueue: (input: string) => void;
}

const FILTERS: Array<{ value: SearchFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "track", label: "Tracks" },
  { value: "artist", label: "Artists" },
  { value: "playlist", label: "Playlists" },
];

export function SearchPanel(props: SearchPanelProps) {
  const { query, results, loading, error, onQueryChange, onSubmit, onQueue } = props;
  const [filter, setFilter] = useState<SearchFilter>("all");
  const visibleResults = useMemo(() => filterSearchResults(results, filter), [results, filter]);

  return (
    <section id="search" className="scroll-mt-4">
      <div className="mb-4 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Find music</h1>
        <p className="text-sm text-white/45">Search Spotify, or paste a track, album, or playlist URL to download it directly.</p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) onSubmit(query.trim());
        }}
      >
        <div className="relative min-w-0 flex-1">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-white/35" />
          <Input
            autoFocus
            aria-label="Search Spotify or paste a Spotify URL"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search tracks, artists, playlists, or paste a Spotify URL"
            className="h-12 rounded-xl border-white/10 bg-white/[0.055] pl-11 pr-4 text-base text-white placeholder:text-white/28 focus-visible:border-primary/40 focus-visible:ring-primary/25"
          />
        </div>
        <Button type="submit" disabled={!query.trim() || loading} className="h-12 rounded-xl px-5 font-semibold">
          {loading ? <IconLoader2 className="size-4 animate-spin" /> : <IconSearch className="size-4" />}
          <span className="hidden sm:inline">Search</span>
        </Button>
      </form>

      {error ? (
        <div role="alert" className="mt-3 rounded-lg border border-red-400/20 bg-red-500/8 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="mt-5">
          <div className="mb-3 flex items-center gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Search result type">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={filter === item.value}
                onClick={() => setFilter(item.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  filter === item.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/[0.055] text-white/55 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
            <span className="ml-auto hidden text-xs tabular-nums text-white/30 sm:block">{visibleResults.length} results</span>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]">
            {visibleResults.length ? visibleResults.map((result) => (
              <SearchResultRow key={`${result.type}:${result.id}`} result={result} onQueue={onQueue} />
            )) : (
              <div className="px-4 py-8 text-center text-sm text-white/35">No {filter} results in this search.</div>
            )}
          </div>
        </div>
      ) : query && !loading && !error ? (
        <div className="mt-8 rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
          <IconMusic className="mx-auto size-8 text-white/18" />
          <p className="mt-3 text-sm font-medium text-white/55">Search Spotify to start a download</p>
          <p className="mt-1 text-xs text-white/30">Tracks download individually. Playlist results queue all resolved tracks.</p>
        </div>
      ) : null}
    </section>
  );
}

function SearchResultRow({ result, onQueue }: { result: SearchResult; onQueue: (input: string) => void }) {
  const queueInput = downloadInputForSearchResult(result);
  const Icon = result.type === "artist" ? IconUser : result.type === "playlist" ? IconPlaylist : IconMusic;

  return (
    <div className="group flex min-h-16 items-center gap-3 border-b border-white/[0.055] px-3 py-2.5 last:border-b-0 hover:bg-white/[0.035] sm:px-4">
      <div className={`size-11 shrink-0 overflow-hidden bg-white/[0.06] ${result.type === "artist" ? "rounded-full" : "rounded-lg"}`}>
        {result.imageUrl ? (
          <img src={result.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="grid size-full place-items-center text-white/25"><Icon className="size-5" /></div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white/90">{result.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/38">
          <span className="capitalize">{result.type}</span><span>·</span><span className="truncate">{result.subtitle}</span>
        </div>
      </div>
      {queueInput ? (
        <Button size="sm" variant="secondary" className="shrink-0 rounded-lg" onClick={() => onQueue(queueInput)}>
          <IconDownload className="size-4" />
          <span className="hidden sm:inline">{result.type === "playlist" ? "Queue playlist" : "Download"}</span>
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 rounded-lg text-white/50"
          onClick={() => window.open(`https://open.spotify.com/artist/${result.id}`, "_blank", "noopener,noreferrer")}
        >
          <IconExternalLink className="size-4" /><span className="hidden sm:inline">Open</span>
        </Button>
      )}
    </div>
  );
}
