import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createServer } from "node:net";
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, getHttpOrigin } from "../src/core/http-config";
import { isHttpEndpointOccupied } from "../src/commands/daemon";

const root = join(import.meta.dir, "..");
const daemonSource = readFileSync(join(root, "src/commands/daemon.ts"), "utf8");
const webSource = readFileSync(join(root, "webapp/src/index.ts"), "utf8");
const instanceSource = readFileSync(join(root, "webapp/src/server/spotify-instance.ts"), "utf8");
const poolSource = readFileSync(join(root, "webapp/src/server/pool.ts"), "utf8");

test("daemon registers its live Spotify instance before starting the web server", () => {
  expect(daemonSource).toContain("registerDaemonSpotifyInstance(instance)");
  expect(daemonSource).toContain("await import(webappEntryUrl)");
  expect(daemonSource.indexOf("registerDaemonSpotifyInstance(instance)"))
    .toBeLessThan(daemonSource.indexOf("await import(webappEntryUrl)"));
  expect(webSource).toContain("await pool.start();");
  expect(webSource.indexOf("await pool.start();")).toBeLessThan(webSource.indexOf("const server = Bun.serve"));
  expect(webSource).not.toContain("pool.start().catch");
});

test("daemon-backed web runtime uses the in-process daemon instance", () => {
  expect(instanceSource).toContain('getDaemonSpotifyInstance().sendCommand(command)');
  expect(instanceSource).toContain("Attached to daemon-owned Spotify instance.");
  expect(poolSource).toContain('if (!USE_DAEMON_INSTANCE) await preparePayload();');
});


test("daemon-owned UI and API share the default 127.0.0.1:8085 listener", () => {
  expect(DEFAULT_HTTP_HOST).toBe("127.0.0.1");
  expect(DEFAULT_HTTP_PORT).toBe(8085);
  expect(getHttpOrigin({ host: DEFAULT_HTTP_HOST, port: DEFAULT_HTTP_PORT })).toBe("http://127.0.0.1:8085");
  expect(webSource).toContain("const HTTP_CONFIG = getHttpConfig()");
});

test("daemon subprocess starts in webapp so Bun loads serve.static plugins", () => {
  expect(daemonSource).toContain("cwd: resolveWebappWorkingDirectory()");
  expect(daemonSource).toContain('existsSync(resolve(candidate, "bunfig.toml"))');
});

test("daemon subprocess pins shared runtime paths before Bun loads webapp .env", () => {
  expect(daemonSource).toContain("SOGGFY_HOME,");
  expect(daemonSource).toContain("SOGGFY_AUTH_DIR: AUTH_DIR");
  expect(daemonSource).toContain("SOGGFY_SOCKET_PATH: IPC_SOCKET");
  expect(daemonSource).toContain("SOGGFY_SAVE_PATH: SAVE_PATH");
});

test("HTTP occupancy probe detects an already-bound configured address", async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    expect(await isHttpEndpointOccupied({ host: "127.0.0.1", port: address.port })).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("daemon start refuses to spawn when the configured HTTP address is occupied", () => {
  expect(daemonSource).toContain("isHttpEndpointOccupied(httpConfig)");
  expect(daemonSource).toContain("Configured web address is already in use; daemon not started.");
  expect(daemonSource.indexOf("isHttpEndpointOccupied(httpConfig)"))
    .toBeLessThan(daemonSource.indexOf("const daemonPid = spawnDaemonProcess()"));
});

test("recovered daemon identity never invents a web origin", () => {
  expect(daemonSource).toContain("identity.httpOrigin");
  expect(daemonSource).toContain("Web UI/API: origin unknown");
  expect(daemonSource).not.toContain("record.httpOrigin ?? getHttpOrigin({ host: DEFAULT_HTTP_HOST");
});

test("daemon startup and status include web API health", () => {
  expect(daemonSource).toContain("isWebServerHealthy(httpOrigin)");
  expect(daemonSource).toContain("Daemon ready: Spotify IPC and web UI/API are responsive.");
  expect(daemonSource).toContain("Web UI/API: responsive");
});
