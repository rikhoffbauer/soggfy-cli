import { expect, test } from "bun:test";
import { formatCommandList } from "../src/core/commands";

import { createApiRoutes } from "../webapp/src/server/routes";

test("lyrics is a first-class CLI command", () => {
  expect(formatCommandList()).toContain("lyrics <track>");
});

test("daemon API exposes a Spotify lyrics route", () => {
  const routes = createApiRoutes();
  expect(typeof routes["/api/lyrics"]?.GET).toBe("function");
});
