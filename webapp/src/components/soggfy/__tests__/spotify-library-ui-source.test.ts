import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const dir = join(import.meta.dir, "..");
const app = readFileSync(join(dir, "../../App.tsx"), "utf8");
const sidebar = readFileSync(join(dir, "AppSidebar.tsx"), "utf8");
const mobile = readFileSync(join(dir, "MobileNavigation.tsx"), "utf8");
const libraryPage = readFileSync(join(dir, "SpotifyLibraryPage.tsx"), "utf8");

test("web UI loads the authenticated Spotify library and renders its own page", () => {
  expect(app).toContain('fetch("/api/library")');
  expect(app).toContain("SpotifyLibraryPage");
  expect(app).toContain('activePage === "spotify"');
  expect(app).toContain("spotifyLibraryError");
});

test("desktop sidebar exposes liked songs before authenticated playlists", () => {
  expect(sidebar).toContain("Liked Songs");
  expect(sidebar).toContain("Library unavailable");
  expect(sidebar).toContain('onClick={() => onOpenSpotifyCollection({ type: "liked" })}');
  expect(sidebar).toContain("spotifyLibrary.playlists.map");
  expect(sidebar.indexOf("Liked Songs")).toBeLessThan(sidebar.indexOf("spotifyLibrary.playlists.map"));
  expect(sidebar).toContain("onOpenSpotifyCollection");
});

test("Spotify library page can browse tracks with existing play and queue actions", () => {
  expect(libraryPage).toContain("export function SpotifyLibraryPage");
  expect(libraryPage).toContain("onPlayTrack");
  expect(libraryPage).toContain("onQueueTrack");
  expect(libraryPage).toContain("selectedCollection.type === \"liked\"");
  expect(libraryPage).toContain("contentsAvailable");
  expect(libraryPage).toContain("onQueuePlaylist");
  expect(app).toContain("const queueSpotifyPlaylist");
  expect(app).toContain("body: JSON.stringify({ playlistId })");
  expect(libraryPage).toContain("onSelectCollection");
  expect(libraryPage).toContain("library.playlists.map");
  expect(libraryPage).toContain("Local file");
});

test("Spotify page surfaces action failures without discarding loaded library data", () => {
  expect(app).toContain("spotifyPageError");
  expect(libraryPage).toContain('role="alert"');
  expect(libraryPage).toContain("error && library");
});

test("mobile navigation keeps the authenticated Spotify library reachable", () => {
  expect(mobile).toContain('{ page: "spotify", label: "Spotify"');
  expect(mobile).toContain("grid-cols-5");
});
