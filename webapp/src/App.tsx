import { useEffect, useMemo, useRef, useState } from "react";
import { IconBook2, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { AppSidebar } from "./components/soggfy/AppSidebar";
import { DiagnosticsPanel } from "./components/soggfy/DiagnosticsPanel";
import { DownloadsPage, QueuePage } from "./components/soggfy/JobWorkspace";
import { AlbumPanel } from "./components/soggfy/AlbumPanel";
import { MobileNavigation } from "./components/soggfy/MobileNavigation";
import type {
  AlbumPage,
  DownloadJob,
  HealthSnapshot,
  JobsSnapshot,
  PlaylistPage,
  SearchResult,
  SpotifyLibrarySnapshot,
} from "./components/soggfy/models";
import { PlayerBar } from "./components/soggfy/PlayerBar";
import { PlaylistPanel } from "./components/soggfy/PlaylistPanel";
import { SearchPanel } from "./components/soggfy/SearchPanel";
import { SpotifyLibraryPage } from "./components/soggfy/SpotifyLibraryPage";
import {
  createSearchSession,
  hashForWorkspaceLocation,
  jobStateByTrack,
  mergeAlbumPages,
  mergePlaylistPages,
  mergeSearchTabPage,
  partitionJobs,
  workspaceLocationFromHash,
  revisionResetAfterHealth,
  searchTabNeedsLoad,
  setActiveSearchTab,
  setSearchTabLoading,
  type SearchTab,
  type SpotifyCollectionSelection,
  type WorkspacePage,
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
  const [activePage, setActivePage] = useState<WorkspacePage>(() =>
    typeof window === "undefined" ? "search" : workspaceLocationFromHash(window.location.hash).page,
  );
  const [snapshot, setSnapshot] = useState<JobsSnapshot>(EMPTY_SNAPSHOT);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [spotifyLibrary, setSpotifyLibrary] = useState<SpotifyLibrarySnapshot | null>(null);
  const [spotifyLibraryLoading, setSpotifyLibraryLoading] = useState(false);
  const [spotifyLibraryError, setSpotifyLibraryError] = useState<string | null>(null);
  const [selectedSpotifyCollection, setSelectedSpotifyCollection] = useState<SpotifyCollectionSelection>(() => {
    if (typeof window === "undefined") return { type: "liked" };
    return workspaceLocationFromHash(window.location.hash).spotifyCollection ?? { type: "liked" };
  });
  const [searchSession, setSearchSession] = useState(() => createSearchSession());
  const [playlistPage, setPlaylistPage] = useState<PlaylistPage | null>(null);
  const [albumPage, setAlbumPage] = useState<AlbumPage | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [queueAllLoading, setQueueAllLoading] = useState(false);
  const [albumQueueAllLoading, setAlbumQueueAllLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playerJobId, setPlayerJobId] = useState<string | null>(null);
  const latestSnapshotRevision = useRef(0);
  const snapshotGeneration = useRef(0);
  const albumRequestGeneration = useRef(0);
  const playlistRequestGeneration = useRef(0);
  const searchRequestGeneration = useRef(0);
  const spotifyLibraryRequestGeneration = useRef(0);
  const appliedLocationHash = useRef<string | null>(null);
  const searchSessionRef = useRef(searchSession);

  useEffect(() => {
    searchSessionRef.current = searchSession;
  }, [searchSession]);

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

  const loadSpotifyLibrary = async () => {
    const requestGeneration = ++spotifyLibraryRequestGeneration.current;
    setSpotifyLibraryLoading(true);
    setSpotifyLibraryError(null);
    try {
      const response = await fetch("/api/library");
      const data = await response.json() as SpotifyLibrarySnapshot & { error?: string };
      if (requestGeneration !== spotifyLibraryRequestGeneration.current) return;
      if (!response.ok) throw new Error(data.error || "Spotify library request failed");
      setSpotifyLibrary(data);
      setSelectedSpotifyCollection((current) => {
        if (current.type === "playlist" && !data.playlists.some((playlist) => playlist.id === current.id)) {
          return { type: "liked" };
        }
        return current;
      });
    } catch (error) {
      if (requestGeneration !== spotifyLibraryRequestGeneration.current) return;
      setSpotifyLibraryError(error instanceof Error ? error.message : "Spotify library request failed");
    } finally {
      if (requestGeneration === spotifyLibraryRequestGeneration.current) setSpotifyLibraryLoading(false);
    }
  };

  useEffect(() => {
    if (!health?.started || (health.readyInstances ?? 0) < 1) return;
    if (spotifyLibrary || spotifyLibraryLoading || spotifyLibraryError) return;
    void loadSpotifyLibrary();
  }, [health?.started, health?.readyInstances, spotifyLibrary, spotifyLibraryLoading, spotifyLibraryError]);

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

  const loadPlaylist = async (
    playlistId: string,
    offset = 0,
    replace = true,
    invalidateSearchGeneration = true,
  ) => {
    albumRequestGeneration.current += 1;
    if (invalidateSearchGeneration) searchRequestGeneration.current += 1;
    setAlbumLoading(false);
    const requestGeneration = ++playlistRequestGeneration.current;
    setPlaylistLoading(true);
    setSearchError(null);
    try {
      const response = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}&offset=${offset}&limit=100`);
      if (requestGeneration !== playlistRequestGeneration.current) return;
      const data = await response.json();
      if (requestGeneration !== playlistRequestGeneration.current) return;
      if (!response.ok) throw Object.assign(new Error(data.error || "Playlist lookup failed"), { status: response.status });
      setAlbumPage(null);
      setPlaylistPage((current) => replace || !current ? data : mergePlaylistPages(current, data));
    } catch (error) {
      if (requestGeneration !== playlistRequestGeneration.current) return;
      throw error;
    } finally {
      if (requestGeneration === playlistRequestGeneration.current) setPlaylistLoading(false);
    }
  };

  const loadAlbum = async (
    albumId: string,
    offset = 0,
    replace = true,
    albumHint?: SearchResult,
    invalidateSearchGeneration = true,
  ) => {
    playlistRequestGeneration.current += 1;
    if (invalidateSearchGeneration) searchRequestGeneration.current += 1;
    setPlaylistLoading(false);
    const requestGeneration = ++albumRequestGeneration.current;
    setAlbumLoading(true);
    setSearchError(null);
    try {
      const response = await fetch(`/api/album?id=${encodeURIComponent(albumId)}&offset=${offset}&limit=100`);
      if (requestGeneration !== albumRequestGeneration.current) return;
      const data = await response.json() as AlbumPage & { error?: string };
      if (!response.ok) throw new Error(data.error || "Album lookup failed");
      if (!data.album) throw new Error("Album lookup returned no album");
      if (albumHint?.type === "album" && albumHint.id === albumId) {
        data.album = {
          ...data.album,
          name: albumHint.name || data.album.name,
          artists: albumHint.subtitle && albumHint.subtitle !== "Unknown artist" ? [albumHint.subtitle] : data.album.artists,
          imageUrl: albumHint.imageUrl || data.album.imageUrl,
        };
      }
      if (requestGeneration !== albumRequestGeneration.current) return;
      setPlaylistPage(null);
      setAlbumPage((current) => replace || !current ? data : mergeAlbumPages(current, data));
    } catch (error) {
      if (requestGeneration !== albumRequestGeneration.current) return;
      throw error;
    } finally {
      if (requestGeneration === albumRequestGeneration.current) setAlbumLoading(false);
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

  const loadTrackResult = async (trackId: string, sourceQuery: string, requestGeneration?: number) => {
    const response = await fetch(`/api/track?id=${encodeURIComponent(trackId)}`);
    if (requestGeneration !== undefined && requestGeneration !== searchRequestGeneration.current) return;
    const data = await response.json() as SearchResult & { error?: string };
    if (requestGeneration !== undefined && requestGeneration !== searchRequestGeneration.current) return;
    if (!response.ok) throw new Error(data.error || "Track lookup failed");
    setPlaylistPage(null);
    setAlbumPage(null);
    setSearchSession(mergeSearchTabPage(createSearchSession(sourceQuery), "track", { items: [data], nextOffset: null }));
  };

  const submitSearch = async (value: string) => {
    const requestGeneration = ++searchRequestGeneration.current;
    albumRequestGeneration.current += 1;
    playlistRequestGeneration.current += 1;
    setAlbumLoading(false);
    setPlaylistLoading(false);
    const submitted = value.trim();
    setSearchError(null);
    setNotice(null);
    try {
      const direct = parseDirectSpotifyInput(submitted);
      if (direct?.type === "playlist") {
        pushWorkspaceLocation({ page: "search", searchTab: "playlist", detail: { type: "playlist", id: direct.id } });
        await loadPlaylist(direct.id, 0, true, false);
        return;
      }
      if (direct?.type === "track") {
        pushWorkspaceLocation({ page: "search", searchTab: "track" });
        await loadTrackResult(direct.id, submitted, requestGeneration);
        return;
      }
      if (direct?.type === "album") {
        pushWorkspaceLocation({ page: "search", searchTab: "album", detail: { type: "album", id: direct.id } });
        await loadAlbum(direct.id, 0, true, undefined, false);
        return;
      }
      if (direct?.type === "bare") {
        const playlistResponse = await fetch(`/api/playlist?id=${encodeURIComponent(direct.id)}&offset=0&limit=100`);
        if (requestGeneration !== searchRequestGeneration.current) return;
        if (playlistResponse.ok) {
          const playlistData = await playlistResponse.json();
          if (requestGeneration !== searchRequestGeneration.current) return;
          pushWorkspaceLocation({ page: "search", searchTab: "playlist", detail: { type: "playlist", id: direct.id } });
          setAlbumPage(null);
          setPlaylistPage(playlistData);
          return;
        }
        if (playlistResponse.status !== 404) {
          const data = await playlistResponse.json().catch(() => ({}));
          if (requestGeneration !== searchRequestGeneration.current) return;
          throw new Error(data.error || "Playlist lookup failed");
        }
        const albumResponse = await fetch(`/api/album?id=${encodeURIComponent(direct.id)}&offset=0&limit=100`);
        if (requestGeneration !== searchRequestGeneration.current) return;
        if (albumResponse.ok) {
          const albumData = await albumResponse.json();
          if (requestGeneration !== searchRequestGeneration.current) return;
          pushWorkspaceLocation({ page: "search", searchTab: "album", detail: { type: "album", id: direct.id } });
          setPlaylistPage(null);
          setAlbumPage(albumData);
          return;
        }
        pushWorkspaceLocation({ page: "search", searchTab: "track" });
        await loadTrackResult(direct.id, submitted, requestGeneration);
        return;
      }

      pushWorkspaceLocation({ page: "search", searchTab: "track" });
      setPlaylistPage(null);
      setAlbumPage(null);
      setSearchSession(createSearchSession(submitted));
      await requestSearchPage(submitted, "track", 0, false);
    } catch (error) {
      if (requestGeneration !== searchRequestGeneration.current) return;
      setSearchError(error instanceof Error ? error.message : "Spotify search failed");
    }
  };

  const changeSearchTab = (tab: SearchTab) => {
    searchRequestGeneration.current += 1;
    albumRequestGeneration.current += 1;
    playlistRequestGeneration.current += 1;
    setAlbumLoading(false);
    setPlaylistLoading(false);
    setPlaylistPage(null);
    setAlbumPage(null);
    const current = searchSession;
    setSearchSession((session) => setActiveSearchTab(session, tab));
    pushWorkspaceLocation({ page: "search", searchTab: tab });
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

  const queueSpotifyPlaylist = async (playlistId: string) => {
    setSearchError(null);
    try {
      const response = await fetch("/api/playlist/queue-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to queue playlist");
      setNotice(`Queued ${data.newlyQueued} new tracks; ${data.existing} already present${data.skipped ? `; ${data.skipped} skipped` : ""}.`);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to queue playlist");
    }
  };

  const queuePlaylistAll = async () => {
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

  const loadMorePlaylist = async () => {
    if (!playlistPage || playlistPage.nextOffset === null) return;
    try {
      await loadPlaylist(playlistPage.playlist.id, playlistPage.nextOffset, false);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to load more tracks");
    }
  };

  const queueAlbumAll = async () => {
    if (!albumPage) return;
    setAlbumQueueAllLoading(true);
    try {
      await queueDownload(`spotify:album:${albumPage.album.id}`);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to queue album");
    } finally {
      setAlbumQueueAllLoading(false);
    }
  };

  const loadMoreAlbum = async () => {
    if (!albumPage || albumPage.nextOffset === null) return;
    try {
      await loadAlbum(albumPage.album.id, albumPage.nextOffset, false);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to load more album tracks");
    }
  };

  const closeSearchDetail = () => {
    searchRequestGeneration.current += 1;
    albumRequestGeneration.current += 1;
    playlistRequestGeneration.current += 1;
    setAlbumLoading(false);
    setPlaylistLoading(false);
    setAlbumPage(null);
    setPlaylistPage(null);
    pushWorkspaceLocation({ page: "search", searchTab: searchSession.activeTab });
  };

  const pushWorkspaceLocation = (location: Parameters<typeof hashForWorkspaceLocation>[0]) => {
    const hash = hashForWorkspaceLocation(location);
    appliedLocationHash.current = hash;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  };

  useEffect(() => {
    const syncWorkspaceFromLocation = () => {
      const hash = window.location.hash || "#search";
      if (appliedLocationHash.current === hash) return;
      appliedLocationHash.current = hash;
      searchRequestGeneration.current += 1;
      const location = workspaceLocationFromHash(hash);
      setActivePage(location.page);
      if (location.page === "spotify") {
        setSearchError(null);
        setSelectedSpotifyCollection(location.spotifyCollection ?? { type: "liked" });
        return;
      }
      if (location.page !== "search") return;

      const tab = location.searchTab ?? "track";
      const currentSession = searchSessionRef.current;
      setSearchSession((session) => setActiveSearchTab(session, tab));
      if (location.detail?.type === "album") {
        void loadAlbum(location.detail.id, 0, true).catch((error) => setSearchError(error.message));
      } else if (location.detail?.type === "playlist") {
        void loadPlaylist(location.detail.id, 0, true).catch((error) => setSearchError(error.message));
      } else {
        albumRequestGeneration.current += 1;
        playlistRequestGeneration.current += 1;
        setAlbumLoading(false);
        setPlaylistLoading(false);
        setAlbumPage(null);
        setPlaylistPage(null);
        if (currentSession.query && searchTabNeedsLoad(currentSession, tab)) {
          void requestSearchPage(currentSession.query, tab, 0, false);
        }
      }
    };
    syncWorkspaceFromLocation();
    window.addEventListener("hashchange", syncWorkspaceFromLocation);
    window.addEventListener("popstate", syncWorkspaceFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncWorkspaceFromLocation);
      window.removeEventListener("popstate", syncWorkspaceFromLocation);
    };
  }, []);

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

  const openSpotifyCollection = (selection: SpotifyCollectionSelection) => {
    searchRequestGeneration.current += 1;
    setSearchError(null);
    setSelectedSpotifyCollection(selection);
    setActivePage("spotify");
    pushWorkspaceLocation({ page: "spotify", spotifyCollection: selection });
  };

  const navigate = (page: WorkspacePage) => {
    searchRequestGeneration.current += 1;
    setActivePage(page);
    if (page === "spotify") {
      setSearchError(null);
      pushWorkspaceLocation({ page, spotifyCollection: selectedSpotifyCollection });
      return;
    }
    pushWorkspaceLocation(page === "search"
      ? {
          page,
          searchTab: searchSession.activeTab,
          ...(albumPage ? { detail: { type: "album" as const, id: albumPage.album.id } }
            : playlistPage ? { detail: { type: "playlist" as const, id: playlistPage.playlist.id } }
              : {}),
        }
      : { page });
  };

  const ready = Boolean(health?.started && (health.readyInstances ?? 0) > 0);
  const spotifyPageError = spotifyLibraryError ?? (activePage === "spotify" ? searchError : null);

  const searchPage = (
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
      onOpenAlbum={(albumHint) => {
        pushWorkspaceLocation({ page: "search", searchTab: "album", detail: { type: "album", id: albumHint.id } });
        void loadAlbum(albumHint.id, 0, true, albumHint).catch((error) => setSearchError(error.message));
      }}
      onOpenPlaylist={(id) => {
        pushWorkspaceLocation({ page: "search", searchTab: "playlist", detail: { type: "playlist", id } });
        void loadPlaylist(id, 0, true).catch((error) => setSearchError(error.message));
      }}
      detail={albumPage ? (
        <AlbumPanel
          page={albumPage}
          jobsByTrack={jobsByTrack}
          loading={albumLoading}
          queueAllLoading={albumQueueAllLoading}
          onBack={closeSearchDetail}
          onPlay={playTrack}
          onQueue={queueTrack}
          onQueueAll={queueAlbumAll}
          onLoadMore={loadMoreAlbum}
        />
      ) : playlistPage ? (
        <PlaylistPanel
          page={playlistPage}
          jobsByTrack={jobsByTrack}
          loading={playlistLoading}
          queueAllLoading={queueAllLoading}
          onBack={closeSearchDetail}
          onPlay={playTrack}
          onQueue={queueTrack}
          onQueueAll={queuePlaylistAll}
          onLoadMore={loadMorePlaylist}
        />
      ) : undefined}
    />
  );

  return (
    <div className="dark flex h-screen min-h-0 w-full overflow-hidden bg-[#101215] text-foreground selection:bg-primary/30">
      <AppSidebar
        activePage={activePage}
        onNavigate={navigate}
        queueCount={queue.length}
        libraryCount={completedCount}
        health={health}
        spotifyLibrary={spotifyLibrary}
        spotifyLibraryLoading={spotifyLibraryLoading}
        spotifyLibraryError={spotifyLibraryError}
        selectedSpotifyCollection={selectedSpotifyCollection}
        onOpenSpotifyCollection={openSpotifyCollection}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b border-white/8 bg-[#101215]/95 px-4 lg:hidden">
          <button type="button" onClick={() => navigate("search")} className="flex items-center gap-2.5 font-bold text-white">
            <img src={logo} alt="" className="size-7 rounded-lg" /> Soggfy
          </button>
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

        <MobileNavigation activePage={activePage} onNavigate={navigate} />

        <main className={`flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6 sm:py-5 xl:px-8 ${playerJob ? "pb-20" : ""}`}>
          {notice ? (
            <div className="mb-3 flex shrink-0 items-center gap-2 border border-primary/15 bg-primary/[0.06] px-3 py-2 text-xs text-primary/90">
              <IconCheck className="size-3.5" /> {notice}
            </div>
          ) : null}

          {activePage === "search" && !health?.started ? (
            <div className="mb-3 flex shrink-0 items-center gap-2 border border-amber-400/15 bg-amber-400/[0.055] px-3 py-2 text-xs text-amber-100/70">
              <IconLoader2 className="size-3.5 animate-spin" /> Capture server is starting. Search remains available while instances initialize.
            </div>
          ) : null}

          {activePage === "search" ? searchPage : null}
          {activePage === "spotify" ? (
            <SpotifyLibraryPage
              library={spotifyLibrary}
              loading={spotifyLibraryLoading}
              error={spotifyPageError}
              selectedCollection={selectedSpotifyCollection}
              jobsByTrack={jobsByTrack}
              onRetry={() => void loadSpotifyLibrary()}
              onPlayTrack={playTrack}
              onQueueTrack={queueTrack}
              onQueuePlaylist={(playlistId) => void queueSpotifyPlaylist(playlistId)}
              onSelectCollection={openSpotifyCollection}
            />
          ) : null}
          {activePage === "queue" ? <QueuePage queue={queue} onAction={runJobAction} /> : null}
          {activePage === "downloads" ? <DownloadsPage library={library} onAction={runJobAction} onPlay={(job: DownloadJob) => setPlayerJobId(job.id)} /> : null}
          {activePage === "diagnostics" ? <DiagnosticsPanel health={health} instances={snapshot.instances} jobs={snapshot.jobs} /> : null}
        </main>
      </div>

      <PlayerBar job={playerJob} onClose={() => setPlayerJobId(null)} />
    </div>
  );
}

export default App;
