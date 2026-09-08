import type { DownloadJob, DownloadState, SearchResult } from "./models";

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
