import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const source = readFileSync(join(import.meta.dir, "../src/core/instance.ts"), "utf8");

test("SpotifyInstance uses the shared minimal login-state clone", () => {
  expect(source).toContain("cloneSpotifyLoginState(appSupportDest)");
  expect(source).not.toContain('join(sourceDir, "PersistentCache")');
  expect(source).not.toContain('["cp", "-R"');
});
