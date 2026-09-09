import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const componentDir = join(import.meta.dir, "..");
const diagnostics = readFileSync(join(componentDir, "DiagnosticsPanel.tsx"), "utf8");
const viewerPath = join(componentDir, "LogViewer.tsx");

test("diagnostics exposes a source-selectable searchable live log viewer", () => {
  expect(existsSync(viewerPath)).toBe(true);
  const viewer = readFileSync(viewerPath, "utf8");
  expect(diagnostics).toContain("<LogViewer");
  expect(viewer).toContain('fetch("/api/logs")');
  expect(viewer).toContain("source=");
  expect(viewer).toContain("Search logs");
  expect(viewer).toContain("Pause");
  expect(viewer).toContain("Raw log");
  expect(viewer).toContain("Job events");
  expect(viewer).toContain("Instance events");
});
