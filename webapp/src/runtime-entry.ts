#!/usr/bin/env bun
import { join } from "node:path";
import { getHttpConfig } from "../../src/core/http-config";
import { CAPTURE_BACKEND } from "../../src/core/paths";
import { CORS_HEADERS } from "./server/http";
import { apiSecurityFromEnv, protectApiRoutes } from "./server/security";
import { createApiRoutes } from "./server/routes";
import { initializeRuntimeState, POOL_SIZE, REPO_ROOT, USE_DAEMON_INSTANCE, pool } from "./server/runtime";

const restoredJobs = initializeRuntimeState();
if (restoredJobs > 0) console.log(`[Server] Restored ${restoredJobs} completed download(s) from sidecars.`);

const HTTP_CONFIG = getHttpConfig();
const PORT = HTTP_CONFIG.port;
const HOSTNAME = HTTP_CONFIG.host;
const API_SECURITY = apiSecurityFromEnv(HOSTNAME);
const WEB_ROOT = join(import.meta.dir, "public");
await pool.start();
const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  idleTimeout: 0,
  routes: {
    "/": Bun.file(join(WEB_ROOT, "index.html")),
    "/*": { dir: WEB_ROOT },
    ...protectApiRoutes(createApiRoutes(), API_SECURITY),
  },
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
});

console.log(`\n=============================================================`);
console.log(`Soggfy supervised API server running at http://${HOSTNAME}:${PORT}`);
console.log(`=============================================================`);
console.log(`- Web UI: http://${HOSTNAME}:${PORT}/`);
console.log(`- Repo root: ${REPO_ROOT}`);
console.log(`- Runtime: ${USE_DAEMON_INSTANCE ? "daemon-owned Spotify instance" : `standalone pool (${POOL_SIZE})`}`);
console.log(`- Capture backend: ${CAPTURE_BACKEND}`);
console.log(`- Health: http://${HOSTNAME}:${PORT}/api/health`);
console.log(`=============================================================\n`);

process.on("SIGINT", async () => {
  console.log("\n[Server] Shutting down...");
  await pool.stop();
  server.stop(true);
  process.exit(0);
});
