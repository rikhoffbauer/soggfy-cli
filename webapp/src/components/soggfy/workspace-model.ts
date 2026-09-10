import type { DownloadJob, DownloadState, PlaylistPage, SearchResult } from "./models";

export type SearchFilter = "all" | "track" | "artist" | "playlist";
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
