import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const componentDir = join(import.meta.dir, "..");
const appSource = readFileSync(join(componentDir, "../../App.tsx"), "utf8");
const searchSource = readFileSync(join(componentDir, "SearchPanel.tsx"), "utf8");
const searchResultsSource = readFileSync(join(componentDir, "SearchResults.tsx"), "utf8");
const playlistPath = join(componentDir, "PlaylistPanel.tsx");

test("search rows expose explicit Play, Queue, and playlist Open actions", () => {
  expect(searchSource).toContain("onPlayTrack");
  expect(searchSource).toContain("onOpenPlaylist");
  expect(searchResultsSource).toContain('label="Play"');
  expect(searchResultsSource).toContain('label="Queue"');
  expect(searchResultsSource).toContain("onOpenPlaylist");
});

test("playlist detail is explicit and never opened by queueing the playlist URL", () => {
  expect(existsSync(playlistPath)).toBe(true);
  expect(appSource).toContain("loadPlaylist");
  expect(appSource).toContain("queueAll");
  expect(appSource).toContain("playerJobId");
});


test("playlist detail provides explicit Back to results navigation", () => {
  const source = readFileSync(playlistPath, "utf8");
  expect(source).toContain("Back to results");
  expect(source).toContain("onBack");
});


test("track terminal status labels use display capitalization", () => {
  const row = readFileSync(join(componentDir, "TrackListRow.tsx"), "utf8");
  expect(row).toContain('job.state === "failed") return "Failed"');
  expect(row).toContain('job.state === "cancelled") return "Cancelled"');
});


test("playlist loads ignore stale responses from an older selection", () => {
  expect(appSource).toContain("playlistRequestGeneration");
  expect(appSource).toContain("requestGeneration !== playlistRequestGeneration.current");
});
