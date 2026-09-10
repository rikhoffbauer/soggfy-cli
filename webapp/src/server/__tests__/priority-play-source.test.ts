import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createApiRoutes } from "../routes";

const poolSource = readFileSync(join(import.meta.dir, "../pool.ts"), "utf8");
const instanceSource = readFileSync(join(import.meta.dir, "../spotify-instance.ts"), "utf8");

test("server exposes explicit priority play and playlist endpoints", () => {
  expect(poolSource).toContain("PriorityJobQueue");
  expect(poolSource).toContain("async playNow(");
  const routes = createApiRoutes();
  for (const path of ["/api/play", "/api/playlist", "/api/track", "/api/playlist/queue-all"] as const) {
    expect(routes[path]).toBeDefined();
  }
});

test("priority interruption has a dedicated non-failure path", () => {
  expect(instanceSource).toContain("JobPriorityInterruptedError");
  expect(poolSource).toContain("requeueAfterPriorityInterruption");
  expect(poolSource).toContain("insertInterrupted");
});
