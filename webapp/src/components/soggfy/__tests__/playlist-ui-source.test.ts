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
