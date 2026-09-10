import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createServer } from "node:net";
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, getHttpOrigin } from "../src/core/http-config";
import { isHttpEndpointOccupied } from "../src/commands/daemon";

const root = join(import.meta.dir, "..");
const daemonSource = readFileSync(join(root, "src/commands/daemon.ts"), "utf8");
const webSource = readFileSync(join(root, "webapp/src/index.ts"), "utf8");

test("daemon registers its live Spotify instance before starting the web server", () => {
  expect(daemonSource).toContain("registerDaemonSpotifyInstance(instance)");
  expect(daemonSource).toContain("await import(webappEntryUrl)");
  expect(daemonSource.indexOf("registerDaemonSpotifyInstance(instance)"))
    .toBeLessThan(daemonSource.indexOf("await import(webappEntryUrl)"));
});

test("daemon-backed web runtime uses the in-process daemon instance", () => {
  expect(webSource).toContain('getDaemonSpotifyInstance().sendCommand(command)');
  expect(webSource).toContain("Attached to daemon-owned Spotify instance.");
  expect(webSource).toContain('if (!USE_DAEMON_INSTANCE) await preparePayload();');
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

test("daemon startup and status include web API health", () => {
  expect(daemonSource).toContain("isWebServerHealthy(httpOrigin)");
  expect(daemonSource).toContain("Daemon ready: Spotify IPC and web UI/API are responsive.");
  expect(daemonSource).toContain("Web UI/API: responsive");
});
