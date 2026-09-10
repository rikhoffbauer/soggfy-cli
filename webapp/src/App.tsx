import { useEffect, useMemo, useRef, useState } from "react";
import { IconBook2, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { AppSidebar } from "./components/soggfy/AppSidebar";
import { DiagnosticsPanel } from "./components/soggfy/DiagnosticsPanel";
import { JobWorkspace } from "./components/soggfy/JobWorkspace";
import type {
  DownloadJob,
  HealthSnapshot,
  JobsSnapshot,
  PlaylistPage,
  SearchResult,
} from "./components/soggfy/models";
import { PlayerBar } from "./components/soggfy/PlayerBar";
import { PlaylistPanel } from "./components/soggfy/PlaylistPanel";
import { SearchPanel } from "./components/soggfy/SearchPanel";
import {
  createSearchSession,
  jobStateByTrack,
  mergePlaylistPages,
  mergeSearchTabPage,
  partitionJobs,
  revisionResetAfterHealth,
  searchTabNeedsLoad,
  setActiveSearchTab,
  setSearchTabLoading,
  type SearchTab,
} from "./components/soggfy/workspace-model";
import logo from "./logo.png";

const EMPTY_SNAPSHOT: JobsSnapshot = { revision: 0, jobs: [], queue: [], instances: [] };
const DOCS_URL = "https://rikhoffbauer.github.io/soggfy-cli/";
const SPOTIFY_ID = /^[a-zA-Z0-9]{22}$/;

type DirectSpotifyInput =
  | { type: "playlist" | "track" | "album" | "bare"; id: string }
  | null;

function parseDirectSpotifyInput(value: string): DirectSpotifyInput {
  const trimmed = value.trim();
  for (const type of ["playlist", "track", "album"] as const) {
    const url = trimmed.match(new RegExp(`open\\.spotify\\.com/${type}/([a-zA-Z0-9]{22})`));
    if (url?.[1]) return { type, id: url[1] };
    const uri = trimmed.match(new RegExp(`spotify:${type}:([a-zA-Z0-9]{22})`));
    if (uri?.[1]) return { type, id: uri[1] };
  }
  if (SPOTIFY_ID.test(trimmed)) return { type: "bare", id: trimmed };
  return null;
}

export function App() {
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<JobsSnapshot>(EMPTY_SNAPSHOT);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [searchSession, setSearchSession] = useState(() => createSearchSession());
  const [playlistPage, setPlaylistPage] = useState<PlaylistPage | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [queueAllLoading, setQueueAllLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playerJobId, setPlayerJobId] = useState<string | null>(null);
  const latestSnapshotRevision = useRef(0);
  const snapshotGeneration = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const generation = snapshotGeneration.current;
      try {
        const jobsResponse = await fetch(`/api/jobs?since=${latestSnapshotRevision.current}`);
        if (cancelled || generation !== snapshotGeneration.current) return;
        if (jobsResponse.status !== 204 && jobsResponse.ok) {
          const incoming = await jobsResponse.json() as JobsSnapshot;
          if (incoming.revision >= latestSnapshotRevision.current) {
            latestSnapshotRevision.current = incoming.revision;
            setSnapshot(incoming);
          }
        }
      } catch {}
    };
    const pollHealth = async () => {
      try {
        const response = await fetch("/api/health");
        if (cancelled || !response.ok) return;
        const incoming = await response.json() as HealthSnapshot;
        const reset = revisionResetAfterHealth(latestSnapshotRevision.current, incoming.revision);
        if (reset.restarted) {
          snapshotGeneration.current += 1;
          latestSnapshotRevision.current = reset.since;
          setSnapshot(EMPTY_SNAPSHOT);
          void poll();
        }
        setHealth(incoming);
      } catch {}
    };
    void poll();
    void pollHealth();
    const jobsTimer = window.setInterval(poll, 1000);
    const healthTimer = window.setInterval(pollHealth, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(jobsTimer);
      window.clearInterval(healthTimer);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const { queue, library } = useMemo(() => partitionJobs(snapshot.jobs), [snapshot.jobs]);
  const jobsByTrack = useMemo(() => jobStateByTrack(snapshot.jobs), [snapshot.jobs]);
  const completedCount = library.filter((job) => job.state === "completed").length;
  const playerJob = playerJobId
    ? snapshot.jobs.find((job) => job.id === playerJobId) || null
    : null;

  const queueDownload = async (input: string) => {
    setSearchError(null);
    setNotice(null);
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: input }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "Failed to queue download");
    const count = Number(data.count || 1);
    setNotice(count > 1 ? `Queued ${count} tracks.` : "Download queued.");
  };

  const loadPlaylist = async (playlistId: string, offset = 0, replace = true) => {
    setPlaylistLoading(true);
    setSearchError(null);
    try {
      const response = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}&offset=${offset}&limit=100`);
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || "Playlist lookup failed"), { status: response.status });
      setPlaylistPage((current) => replace || !current ? data : mergePlaylistPages(current, data));
    } finally {
      setPlaylistLoading(false);
    }
  };

  const requestSearchPage = async (searchQuery: string, tab: SearchTab, offset = 0, append = false) => {
    setSearchError(null);
    setSearchSession((current) => current.query === searchQuery ? setSearchTabLoading(current, tab, true) : current);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&type=${tab}&offset=${offset}&limit=40`);
      const data = await response.json() as { items?: SearchResult[]; nextOffset?: number | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Spotify search failed");
      const page = { items: Array.isArray(data.items) ? data.items : [], nextOffset: data.nextOffset ?? null };
      setSearchSession((current) => current.query === searchQuery ? mergeSearchTabPage(current, tab, page, append) : current);
    } catch (error) {
      setSearchSession((current) => current.query === searchQuery ? setSearchTabLoading(current, tab, false) : current);
      setSearchError(error instanceof Error ? error.message : "Spotify search failed");
    }
  };

  const loadTrackResult = async (trackId: string, sourceQuery: string) => {
    const response = await fetch(`/api/track?id=${encodeURIComponent(trackId)}`);
    const data = await response.json() as SearchResult & { error?: string };
    if (!response.ok) throw new Error(data.error || "Track lookup failed");
    setPlaylistPage(null);
    setSearchSession(mergeSearchTabPage(createSearchSession(sourceQuery), "track", { items: [data], nextOffset: null }));
  };

  const submitSearch = async (value: string) => {
    const submitted = value.trim();
    setSearchError(null);
    setNotice(null);
    try {
      const direct = parseDirectSpotifyInput(submitted);
      if (direct?.type === "playlist") {
        await loadPlaylist(direct.id, 0, true);
        return;
      }
      if (direct?.type === "track") {
        await loadTrackResult(direct.id, submitted);
        return;
      }
      if (direct?.type === "album") {
        window.open(`https://open.spotify.com/album/${direct.id}`, "_blank", "noopener,noreferrer");
        return;
      }
      if (direct?.type === "bare") {
        const response = await fetch(`/api/playlist?id=${encodeURIComponent(direct.id)}&offset=0&limit=100`);
        if (response.ok) {
          setPlaylistPage(await response.json());
          return;
        }
        const data = await response.json().catch(() => ({}));
        if (response.status !== 404) throw new Error(data.error || "Playlist lookup failed");
        await loadTrackResult(direct.id, submitted);
        return;
      }

      setPlaylistPage(null);
      setSearchSession(createSearchSession(submitted));
      await requestSearchPage(submitted, "track", 0, false);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Spotify search failed");
    }
  };

  const changeSearchTab = (tab: SearchTab) => {
    const current = searchSession;
    setSearchSession((session) => setActiveSearchTab(session, tab));
    if (current.query && searchTabNeedsLoad(current, tab)) void requestSearchPage(current.query, tab, 0, false);
  };

  const loadMoreSearch = (tab: SearchTab) => {
    const current = searchSession.tabs[tab];
    if (!searchSession.query || current.loading || current.nextOffset === null) return;
    void requestSearchPage(searchSession.query, tab, current.nextOffset, true);
  };

  const playTrack = async (trackId: string) => {
    setSearchError(null);
    try {
      const response = await fetch("/api/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.job?.id) throw new Error(data.error || "Failed to start playback");
      setPlayerJobId(data.job.id);
      const revision = Number(data.revision || 0);
      latestSnapshotRevision.current = Math.max(latestSnapshotRevision.current, revision);
      setSnapshot((current) => ({
        ...current,
        revision: Math.max(current.revision, revision),
        jobs: current.jobs.some((job) => job.id === data.job.id)
          ? current.jobs.map((job) => job.id === data.job.id ? data.job : job)
          : [...current.jobs, data.job],
      }));
      setNotice(data.interruptedJobId ? "Playback started; previous download will resume afterward." : "Playback started.");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to start playback");
    }
  };

  const queueTrack = async (trackId: string) => {
    try {
      await queueDownload(`spotify:track:${trackId}`);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to queue track");
    }
  };

  const queueAll = async () => {
    if (!playlistPage) return;
    setQueueAllLoading(true);
    setSearchError(null);
    try {
      const response = await fetch("/api/playlist/queue-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: playlistPage.playlist.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to queue playlist");
      setNotice(`Queued ${data.newlyQueued} new tracks; ${data.existing} already present${data.skipped ? `; ${data.skipped} skipped` : ""}.`);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to queue playlist");
    } finally {
      setQueueAllLoading(false);
    }
  };

  const loadMore = async () => {
    if (!playlistPage || playlistPage.nextOffset === null) return;
    try {
      await loadPlaylist(playlistPage.playlist.id, playlistPage.nextOffset, false);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to load more tracks");
    }
  };

  const runJobAction = async (jobId: string, action: "cancel" | "retry") => {
    setSearchError(null);
    try {
      const response = await fetch("/api/jobs/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || `Failed to ${action} job`);
      setNotice(action === "cancel" ? "Download cancelled." : "Retry queued.");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : `Failed to ${action} job`);
    }
  };

  const ready = Boolean(health?.started && (health.readyInstances ?? 0) > 0);

  return (
    <div className="dark flex min-h-screen w-full bg-[#101215] text-foreground selection:bg-primary/30">
      <AppSidebar queueCount={queue.length} libraryCount={completedCount} health={health} />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center border-b border-white/8 bg-[#101215]/90 px-4 backdrop-blur-xl lg:hidden">
          <a href="#search" className="flex items-center gap-2.5 font-bold text-white">
            <img src={logo} alt="" className="size-7 rounded-lg" /> Soggfy
          </a>
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-white/40">
              <span className={`size-1.5 rounded-full ${ready ? "bg-primary" : "bg-amber-400"}`} />
              {ready ? "Ready" : "Starting"}
            </span>
            <a href={DOCS_URL} target="_blank" rel="noreferrer" aria-label="Documentation" className="rounded-md p-1.5 text-white/40 hover:bg-white/8 hover:text-white">
              <IconBook2 className="size-4" />
            </a>
          </div>
        </header>

        <main className={`mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 xl:px-8 ${playerJob ? "pb-28" : "pb-10"}`}>
          <SearchPanel
            query={query}
            session={searchSession}
            error={searchError}
            onQueryChange={setQuery}
            onSubmit={submitSearch}
            onTabChange={changeSearchTab}
            onLoadMore={loadMoreSearch}
            onPlayTrack={playTrack}
            onQueueTrack={queueTrack}
            onOpenAlbum={(id) => window.open(`https://open.spotify.com/album/${id}`, "_blank", "noopener,noreferrer")}
            onOpenPlaylist={(id) => void loadPlaylist(id, 0, true).catch((error) => setSearchError(error.message))}
          />

          {notice ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/15 bg-primary/[0.06] px-3 py-2 text-xs text-primary/90">
              <IconCheck className="size-3.5" /> {notice}
            </div>
          ) : null}

          {playlistPage ? (
            <PlaylistPanel
              page={playlistPage}
              jobsByTrack={jobsByTrack}
              loading={playlistLoading}
              queueAllLoading={queueAllLoading}
              onPlay={playTrack}
              onQueue={queueTrack}
              onQueueAll={queueAll}
              onLoadMore={loadMore}
            />
          ) : null}

          {!health?.started ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.055] px-3 py-2 text-xs text-amber-100/70">
              <IconLoader2 className="size-3.5 animate-spin" /> Capture server is starting. Search remains available while instances initialize.
            </div>
          ) : null}

          <div className="mt-6">
            <JobWorkspace
              queue={queue}
              library={library}
              onAction={runJobAction}
              onPlay={(job: DownloadJob) => setPlayerJobId(job.id)}
            />
          </div>

          <div className="mt-5">
            <DiagnosticsPanel health={health} instances={snapshot.instances} jobs={snapshot.jobs} />
          </div>
        </main>
      </div>

      <PlayerBar job={playerJob} onClose={() => setPlayerJobId(null)} />
    </div>
  );
}

export default App;
