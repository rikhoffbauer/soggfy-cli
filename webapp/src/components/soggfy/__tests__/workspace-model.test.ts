import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DIAGNOSTICS_OPEN,
  filterSearchResults,
  partitionJobs,
  type FrontendDownloadJob,
  type FrontendSearchResult,
} from "../workspace-model";

const results: FrontendSearchResult[] = [
  { id: "t1", uri: "spotify:track:t1", type: "track", name: "Track", subtitle: "Artist" },
  { id: "a1", uri: "spotify:artist:a1", type: "artist", name: "Artist", subtitle: "Artist" },
  { id: "p1", uri: "spotify:playlist:p1", type: "playlist", name: "Playlist", subtitle: "Owner" },
];

describe("search result filtering", () => {
  test("all preserves catalog ordering", () => {
    expect(filterSearchResults(results, "all")).toEqual(results);
  });

  test("filters to a specific result type", () => {
    expect(filterSearchResults(results, "artist").map((item) => item.id)).toEqual(["a1"]);
  });
});

describe("job workspace partitioning", () => {
  const jobs = [
    { id: "1", trackId: "t1", state: "queued", createdAt: "2026-09-08T00:00:00Z" },
    { id: "2", trackId: "t2", state: "capturing", createdAt: "2026-09-08T00:01:00Z" },
    { id: "3", trackId: "t3", state: "completed", createdAt: "2026-09-08T00:02:00Z" },
    { id: "4", trackId: "t4", state: "failed", createdAt: "2026-09-08T00:03:00Z" },
  ] as FrontendDownloadJob[];

  test("keeps active work in queue and terminal work in library", () => {
    const partitioned = partitionJobs(jobs);
    expect(partitioned.queue.map((job) => job.id)).toEqual(["1", "2"]);
    expect(partitioned.library.map((job) => job.id)).toEqual(["4", "3"]);
  });
});

test("diagnostics are collapsed by default", () => {
  expect(DEFAULT_DIAGNOSTICS_OPEN).toBe(false);
});


test("search results map to queueable Spotify inputs", async () => {
  const { downloadInputForSearchResult } = await import("../workspace-model");
  expect(downloadInputForSearchResult(results[0]!)).toBe("spotify:track:t1");
  expect(downloadInputForSearchResult(results[2]!)).toBe("https://open.spotify.com/playlist/p1");
  expect(downloadInputForSearchResult(results[1]!)).toBeNull();
});
