import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

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
