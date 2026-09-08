import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const source = readFileSync(join(import.meta.dir, "../src/core/instance.ts"), "utf8");

test("SpotifyInstance terminates its exact process tree through the shared helper", () => {
  expect(source).not.toContain("detached: true");
  expect(source).toContain("terminateProcessTree(pid, this.process.exited)");
  expect(source).not.toContain("pkill");
});
