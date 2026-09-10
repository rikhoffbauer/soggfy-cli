import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const componentDir = join(import.meta.dir, "..");
const searchSource = readFileSync(join(componentDir, "SearchPanel.tsx"), "utf8");
const resultsSource = readFileSync(join(componentDir, "SearchResults.tsx"), "utf8");
const appSource = readFileSync(join(componentDir, "../../App.tsx"), "utf8");

test("search exposes exactly four non-mixed result tabs", () => {
  for (const label of ["Tracks", "Albums", "Playlists", "Artists"]) {
    expect(searchSource).toContain(`label: "${label}"`);
  }
  expect(searchSource).not.toContain('label: "All"');
  expect(searchSource).toContain("onTabChange");
});

test("search results use type-specific views and explicit pagination", () => {
  expect(resultsSource).toContain("TrackResults");
  expect(resultsSource).toContain("GridResults");
  expect(resultsSource).toContain("onOpenAlbum");
  expect(resultsSource).toContain("onOpenPlaylist");
  expect(resultsSource).toContain("Load more");
  expect(resultsSource).toContain("onLoadMore");
});

test("App requests typed search pages at 40 items and preserves session state", () => {
  expect(appSource).toContain("createSearchSession");
  expect(appSource).toContain("setActiveSearchTab");
  expect(appSource).toContain("mergeSearchTabPage");
  expect(appSource).toContain("limit=40");
  expect(appSource).toContain("type=${tab}");
});
