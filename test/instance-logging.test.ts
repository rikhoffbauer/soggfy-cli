import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("daemon-owned Spotify persists stdout and stderr for web diagnostics", () => {
  const source = readFileSync(join(import.meta.dir, "../src/core/instance.ts"), "utf8");
  expect(source).toContain('join(this.profileDir, "spotify.log")');
  expect(source).toContain('join(this.profileDir, "spotify.err")');
  expect(source).not.toContain('stdout: "ignore"');
  expect(source).not.toContain('stderr: "ignore"');
});
