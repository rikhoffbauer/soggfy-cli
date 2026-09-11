import type { AlbumPage, DownloadJob, DownloadState, PlaylistPage, SearchResult } from "./models";

export type SearchFilter = "all" | "track" | "artist" | "playlist";

export type WorkspacePage = "search" | "queue" | "downloads" | "diagnostics";
export type SearchTab = "track" | "album" | "playlist" | "artist";
export type SearchDetail = { type: "album" | "playlist"; id: string };
export interface WorkspaceLocation {
  page: WorkspacePage;
  searchTab?: SearchTab;
  detail?: SearchDetail;
}

export interface SearchTabState {
  items: FrontendSearchResult[];
  loaded: boolean;
  loading: boolean;
  nextOffset: number | null;
}

export interface SearchSession {
  query: string;
  activeTab: SearchTab;
  tabs: Record<SearchTab, SearchTabState>;
}

const SEARCH_TABS: readonly SearchTab[] = ["track", "album", "playlist", "artist"];
const WORKSPACE_PAGES: readonly WorkspacePage[] = ["search", "queue", "downloads", "diagnostics"];

function emptySearchTabState(): SearchTabState {
  return { items: [], loaded: false, loading: false, nextOffset: 0 };
}

export function workspaceLocationFromHash(hash: string): WorkspaceLocation {
  const raw = hash.replace(/^#/, "");
  const [pageValue, query = ""] = raw.split("?", 2);
  const page = WORKSPACE_PAGES.includes(pageValue as WorkspacePage)
    ? pageValue as WorkspacePage
    : "search";
  if (page !== "search") return { page };

  const params = new URLSearchParams(query);
  const requestedTab = params.get("tab") as SearchTab | null;
  const searchTab = requestedTab && SEARCH_TABS.includes(requestedTab) ? requestedTab : "track";
  const albumId = params.get("album");
  const playlistId = params.get("playlist");
  const detail = albumId
    ? { type: "album" as const, id: albumId }
    : playlistId
      ? { type: "playlist" as const, id: playlistId }
      : undefined;
  return { page, searchTab: detail?.type ?? searchTab, ...(detail ? { detail } : {}) };
}

export function hashForWorkspaceLocation(location: WorkspaceLocation): string {
  if (location.page !== "search") return `#${location.page}`;
  const params = new URLSearchParams();
  const tab = location.detail?.type ?? location.searchTab ?? "track";
  if (tab !== "track") params.set("tab", tab);
  if (location.detail) params.set(location.detail.type, location.detail.id);
  const query = params.toString();
  return `#search${query ? `?${query}` : ""}`;
}

export function pageFromHash(hash: string): WorkspacePage {
  return workspaceLocationFromHash(hash).page;
}

export function hashForPage(page: WorkspacePage): string {
  return hashForWorkspaceLocation({ page });
}

export function createSearchSession(query = ""): SearchSession {
  return {
    query: query.trim(),
    activeTab: "track",
    tabs: Object.fromEntries(SEARCH_TABS.map((tab) => [tab, emptySearchTabState()])) as Record<SearchTab, SearchTabState>,
  };
}

export function resetSearchSessionQuery(_session: SearchSession, query: string): SearchSession {
  return createSearchSession(query);
}

export function searchTabNeedsLoad(session: SearchSession, tab: SearchTab): boolean {
  const state = session.tabs[tab];
  return !state.loaded && !state.loading;
}

export function mergeSearchTabPage(
  session: SearchSession,
  tab: SearchTab,
  page: { items: FrontendSearchResult[]; nextOffset: number | null },
  append = false,
): SearchSession {
  const current = session.tabs[tab];
  const combined = append ? [...current.items, ...page.items] : [...page.items];
  const seen = new Set<string>();
  const items = combined.filter((item) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    ...session,
    tabs: {
      ...session.tabs,
      [tab]: { items, loaded: true, loading: false, nextOffset: page.nextOffset },
    },
  };
}

export function setSearchTabLoading(session: SearchSession, tab: SearchTab, loading: boolean): SearchSession {
  return {
    ...session,
    tabs: { ...session.tabs, [tab]: { ...session.tabs[tab], loading } },
  };
}

export function setActiveSearchTab(session: SearchSession, tab: SearchTab): SearchSession {
  return { ...session, activeTab: tab };
}
export type FrontendSearchResult = SearchResult;
export type FrontendDownloadState = DownloadState;
export type FrontendDownloadJob = DownloadJob;

export const DEFAULT_DIAGNOSTICS_OPEN = false;

export function filterSearchResults(
  results: readonly FrontendSearchResult[],
  filter: SearchFilter,
): FrontendSearchResult[] {
  if (filter === "all") return [...results];
  return results.filter((result) => result.type === filter);
}

const TERMINAL_STATES = new Set<FrontendDownloadState>([
  "completed",
  "failed",
  "cancelled",
]);

export function partitionJobs(jobs: readonly FrontendDownloadJob[]) {
  const queue: FrontendDownloadJob[] = [];
  const library: FrontendDownloadJob[] = [];

  for (const job of jobs) {
    (TERMINAL_STATES.has(job.state) ? library : queue).push(job);
  }

  library.sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  return { queue, library };
}

export function downloadInputForSearchResult(result: FrontendSearchResult): string | null {
  if (result.type === "track") return result.uri;
  if (result.type === "playlist") return `https://open.spotify.com/playlist/${result.id}`;
  return null;
}

export function actionForSearchResult(result: FrontendSearchResult): FrontendSearchResult["type"] {
  return result.type;
}

export function mergeAlbumPages(current: AlbumPage, incoming: AlbumPage): AlbumPage {
  const seen = new Set<string>();
  const tracks = [...current.tracks, ...incoming.tracks]
    .filter((track) => {
      const key = `${track.sourceIndex}:${track.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
  return {
    ...incoming,
    album: current.album,
    tracks,
    trackIds: tracks.map((track) => track.id),
    offset: 0,
    totalCount: Math.max(current.totalCount, incoming.totalCount),
  };
}

export function mergePlaylistPages(current: PlaylistPage, incoming: PlaylistPage): PlaylistPage {
  const seen = new Set<string>();
  const tracks = [...current.tracks, ...incoming.tracks]
    .filter((track) => {
      const key = `${track.sourceIndex}:${track.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
  const issueMap = new Map([...current.issues, ...incoming.issues].map((issue) => [`${issue.index}:${issue.reason}`, issue]));
  return {
    ...incoming,
    playlist: current.playlist,
    tracks,
    issues: [...issueMap.values()].sort((a, b) => a.index - b.index),
    offset: 0,
    totalCount: Math.max(current.totalCount, incoming.totalCount),
  };
}

export function jobStateByTrack(jobs: readonly FrontendDownloadJob[]): Map<string, FrontendDownloadJob> {
  const map = new Map<string, FrontendDownloadJob>();
  for (const job of jobs) {
    const existing = map.get(job.trackId);
    if (!existing || Date.parse(job.updatedAt || job.createdAt) >= Date.parse(existing.updatedAt || existing.createdAt)) {
      map.set(job.trackId, job);
    }
  }
  return map;
}

export function revisionResetAfterHealth(
  currentRevision: number,
  serverRevision: number | undefined,
): { restarted: boolean; since: number } {
  if (!Number.isInteger(serverRevision) || serverRevision! < 0 || serverRevision! >= currentRevision) {
    return { restarted: false, since: currentRevision };
  }
  return { restarted: true, since: serverRevision! - 1 };
}
