import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const source = readFileSync(join(import.meta.dir, "../../index.ts"), "utf8");

test("server exposes explicit priority play and playlist endpoints", () => {
  expect(source).toContain("PriorityJobQueue");
  expect(source).toContain("async playNow(");
  expect(source).toContain('"/api/play"');
  expect(source).toContain('"/api/playlist"');
  expect(source).toContain('"/api/track"');
  expect(source).toContain('"/api/playlist/queue-all"');
});

test("priority interruption has a dedicated non-failure path", () => {
  expect(source).toContain("JobPriorityInterruptedError");
  expect(source).toContain("requeueAfterPriorityInterruption");
  expect(source).toContain("insertInterrupted");
});
