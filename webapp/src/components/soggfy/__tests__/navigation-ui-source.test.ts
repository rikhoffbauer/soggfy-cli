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
  expect(app).toContain("pageFromHash");
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
