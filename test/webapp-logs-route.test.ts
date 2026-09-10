import { expect, test } from "bun:test";
import { createApiRoutes } from "../webapp/src/server/routes";

test("webapp exposes catalog access for allow-listed log sources", async () => {
  const routes = createApiRoutes();
  const response = await routes["/api/logs"].GET(new Request("http://localhost/api/logs"));
  expect(response.status).toBe(200);
  const body = await response.json() as { sources?: unknown[] };
  expect(Array.isArray(body.sources)).toBe(true);
});
