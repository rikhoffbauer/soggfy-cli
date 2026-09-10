import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const componentDir = join(import.meta.dir, "..");
const albumPath = join(componentDir, "AlbumPanel.tsx");
const appSource = readFileSync(join(componentDir, "../../App.tsx"), "utf8");

test("album detail is an in-app paginated track view", () => {
  expect(existsSync(albumPath)).toBe(true);
  if (!existsSync(albumPath)) return;
  const source = readFileSync(albumPath, "utf8");
  expect(source).toContain("Back to results");
  expect(source).toContain("Queue all");
  expect(source).toContain("onLoadMore");
  expect(source).toContain("onPlay");
  expect(source).toContain("onQueue");
});

test("App opens album detail without queueing the album implicitly", () => {
  expect(appSource).toContain("loadAlbum");
  expect(appSource).toContain("mergeAlbumPages");
  expect(appSource).toContain("setAlbumPage");
  expect(appSource).toContain("spotify:album:${albumPage.album.id}");
});


test("album detail preserves metadata from the selected search result", () => {
  const resultsSource = readFileSync(join(componentDir, "SearchResults.tsx"), "utf8");
  expect(resultsSource).toContain("onOpenAlbum(result)");
  expect(appSource).toContain("albumHint");
  expect(appSource).toContain("albumHint.subtitle");
});
