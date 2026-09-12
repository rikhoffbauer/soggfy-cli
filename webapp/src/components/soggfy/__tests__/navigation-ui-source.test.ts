import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const dir = join(import.meta.dir, "..");
const app = readFileSync(join(dir, "../../App.tsx"), "utf8");
const sidebar = readFileSync(join(dir, "AppSidebar.tsx"), "utf8");
const jobs = readFileSync(join(dir, "JobWorkspace.tsx"), "utf8");
const diagnostics = readFileSync(join(dir, "DiagnosticsPanel.tsx"), "utf8");
const logs = readFileSync(join(dir, "LogViewer.tsx"), "utf8");
const mobile = readFileSync(join(dir, "MobileNavigation.tsx"), "utf8");

test("workspace has four real pages with active navigation instead of anchor scrolling", () => {
  expect(app).toContain("WorkspacePage");
  expect(app).toContain("workspaceLocationFromHash");
  expect(app).toContain("activePage");
  expect(sidebar).toContain("activePage");
  expect(sidebar).toContain("onNavigate");
  expect(sidebar).not.toContain('href="#queue"');
  expect(sidebar).not.toContain('href="#library"');
  expect(sidebar).not.toContain('href="#diagnostics"');
});

test("main workspace uses available width and renders queue/download pages independently", () => {
  expect(app).not.toContain("max-w-6xl");
  expect(jobs).toContain("export function QueuePage");
  expect(jobs).toContain("export function DownloadsPage");
  expect(jobs).not.toContain("max-h-[420px]");
});

test("diagnostics and logs can consume the remaining page height", () => {
  expect(diagnostics).not.toContain("DEFAULT_DIAGNOSTICS_OPEN");
  expect(diagnostics).toContain("flex min-h-0 flex-1 flex-col");
  expect(logs).not.toContain("max-h-[460px]");
  expect(logs).toContain("flex min-h-0 flex-1 flex-col");
});

test("mobile navigation exposes the same four destinations", () => {
  expect(app).toContain("MobileNavigation");
  for (const page of ["Search", "Queue", "Downloads", "Diagnostics"]) expect(mobile).toContain(page);
});


test("browser history restores search tab and detail state", () => {
  expect(app).toContain("workspaceLocationFromHash");
  expect(app).toContain("hashForWorkspaceLocation");
  expect(app).toContain('detail: { type: "album"');
  expect(app).toContain('detail: { type: "playlist"');
});

test("mobile icon navigation keeps accessible names", () => {
  expect(mobile).toContain("aria-label={item.label}");
});


test("direct search/detail transitions also update the workspace hash", () => {
  expect(app).toContain('pushWorkspaceLocation({ page: "search", searchTab: "track" })');
  expect(app).toContain('pushWorkspaceLocation({ page: "search", searchTab: "album", detail: { type: "album", id: direct.id } })');
  expect(app).toContain('pushWorkspaceLocation({ page: "search", searchTab: "playlist", detail: { type: "playlist", id: direct.id } })');
});


test("search resolution ignores stale async responses after navigation", () => {
  expect(app).toContain("searchRequestGeneration");
  expect(app).toContain("requestGeneration !== searchRequestGeneration.current");
});


test("new searches and result-tab exits invalidate pending detail requests cleanly", () => {
  const submitSearchStart = app.indexOf("const submitSearch");
  const changeSearchTabStart = app.indexOf("const changeSearchTab");
  expect(submitSearchStart).toBeGreaterThanOrEqual(0);
  expect(changeSearchTabStart).toBeGreaterThanOrEqual(0);
  const submit = app.slice(submitSearchStart, changeSearchTabStart);
  expect(submit).toContain("albumRequestGeneration.current += 1");
  expect(submit).toContain("playlistRequestGeneration.current += 1");
  expect(submit).toContain("setAlbumLoading(false)");
  expect(submit).toContain("setPlaylistLoading(false)");

  const loadMoreSearchStart = app.indexOf("const loadMoreSearch");
  expect(loadMoreSearchStart).toBeGreaterThanOrEqual(0);
  const tabChange = app.slice(changeSearchTabStart, loadMoreSearchStart);
  expect(tabChange).toContain("albumRequestGeneration.current += 1");
  expect(tabChange).toContain("playlistRequestGeneration.current += 1");
  expect(tabChange).toContain("setAlbumLoading(false)");
  expect(tabChange).toContain("setPlaylistLoading(false)");

  const closeDetail = app.slice(app.indexOf("const closeSearchDetail"), app.indexOf("const pushWorkspaceLocation"));
  expect(closeDetail).toContain("albumRequestGeneration.current += 1");
  expect(closeDetail).toContain("playlistRequestGeneration.current += 1");
  expect(closeDetail).toContain("setAlbumLoading(false)");
  expect(closeDetail).toContain("setPlaylistLoading(false)");
});


test("direct album and playlist submissions preserve their search request generation", () => {
  const playlistLoader = app.slice(app.indexOf("const loadPlaylist"), app.indexOf("const loadAlbum"));
  const albumLoader = app.slice(app.indexOf("const loadAlbum"), app.indexOf("const requestSearchPage"));
  const submit = app.slice(app.indexOf("const submitSearch"), app.indexOf("const changeSearchTab"));
  expect(playlistLoader).toContain("invalidateSearchGeneration");
  expect(albumLoader).toContain("invalidateSearchGeneration");
  expect(submit).toContain("loadPlaylist(direct.id, 0, true, false)");
  expect(submit).toContain("loadAlbum(direct.id, 0, true, undefined, false)");
});

test("browser history lazy-loads an uncached restored search tab", () => {
  const historySync = app.slice(app.indexOf("const syncWorkspaceFromLocation"), app.indexOf("window.addEventListener"));
  expect(app).toContain("searchSessionRef");
  expect(historySync).toContain("searchTabNeedsLoad(currentSession, tab)");
  expect(historySync).toContain("requestSearchPage(currentSession.query, tab, 0, false)");
});
