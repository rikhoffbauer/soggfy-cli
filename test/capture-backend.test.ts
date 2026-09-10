import { expect, test } from "bun:test";
import { CAPTURE_BACKEND } from "../src/core/paths";
import { createApiRoutes } from "../webapp/src/server/routes";

test("CLI and webapp default to the live-validated Ogg backend", async () => {
  expect(CAPTURE_BACKEND).toBe("ogg");
  const response = await createApiRoutes()["/api/health"].GET(new Request("http://localhost/api/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ captureBackend: "ogg" });
});
