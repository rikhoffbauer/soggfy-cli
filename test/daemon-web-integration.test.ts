import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, getHttpOrigin } from "../src/core/http-config";

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

test("daemon startup and status include web API health", () => {
  expect(daemonSource).toContain("isWebServerHealthy(httpOrigin)");
  expect(daemonSource).toContain("Daemon ready: Spotify IPC and web UI/API are responsive.");
  expect(daemonSource).toContain("Web UI/API: responsive");
});
