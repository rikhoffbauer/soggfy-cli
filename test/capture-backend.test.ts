import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");

test("CLI and webapp default to the live-validated Ogg backend", () => {
  const paths = readFileSync(join(root, "src/core/paths.ts"), "utf8");
  const webapp = readFileSync(join(root, "webapp/src/index.ts"), "utf8");
  expect(paths).toContain('process.env.SOGGFY_CAPTURE_BACKEND || "ogg"');
  expect(webapp).toContain("CAPTURE_BACKEND,");
  expect(webapp).toContain('from "../../src/core/paths"');
  expect(webapp).not.toContain("const CAPTURE_BACKEND = process.env");
});
