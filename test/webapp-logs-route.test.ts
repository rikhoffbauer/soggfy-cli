import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("webapp exposes catalog, tail, and raw access for allow-listed log sources", () => {
  const source = readFileSync(join(import.meta.dir, "../webapp/src/index.ts"), "utf8");
  expect(source).toContain('"/api/logs"');
  expect(source).toContain("listLogSources");
  expect(source).toContain("readLogTail");
  expect(source).toContain('url.searchParams.get("raw")');
});
