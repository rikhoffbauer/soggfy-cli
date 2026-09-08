import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");

test("download is the canonical CLI command and stream is only an alias", () => {
  const cli = readFileSync(join(root, "src/cli.ts"), "utf8");
  expect(cli).toContain('case "download"');
  expect(cli).toContain('import("./commands/download")');
  expect(cli).toContain('case "stream"');
  expect(cli).toContain("deprecated");
});

test("install instructions point users at the download command", () => {
  const install = readFileSync(join(root, "src/commands/install.ts"), "utf8");
  expect(install).toContain("soggfy download <track>");
  expect(install).not.toContain("soggfy stream <track>");
});
