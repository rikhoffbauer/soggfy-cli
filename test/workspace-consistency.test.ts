import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const setup = readFileSync(join(root, "setup.sh"), "utf8");
const doctor = readFileSync(join(root, "scripts/doctor.ts"), "utf8");
const runtimeConfig = readFileSync(join(root, "webapp/src/server/runtime-config.ts"), "utf8");
const instanceSource = readFileSync(join(root, "webapp/src/server/spotify-instance.ts"), "utf8");

test("setup uses the same ~/.soggfy workspace as the CLI", () => {
  expect(setup).toContain('SOGGFY_HOME="${SOGGFY_HOME:-$HOME/.soggfy}"');
  expect(setup).toContain('WORKSPACE_DIR="$SOGGFY_HOME/workspace"');
  expect(setup).not.toContain('WORKSPACE_DIR="$ROOT_DIR/workspace"');
});

test("doctor consumes shared runtime paths and current dependencies", () => {
  expect(doctor).toContain('from "../src/core/paths"');
  expect(doctor).not.toContain('workspace/PatchedSpotify.app');
  expect(doctor).not.toContain('"pkg-config"');
  expect(doctor).toContain('CAPTURE_BACKEND');
});


test("setup delegates login capture to the isolated auth command", () => {
  expect(setup).toContain('bun "$ROOT_DIR/src/cli.ts" auth login');
  expect(setup).not.toContain('killall Spotify');
  expect(setup).not.toContain('rm -rf "$PATCHED_APP"');
});


test("webapp runtime state is scoped under the shared SOGGFY_HOME", () => {
  expect(runtimeConfig).toContain('RUNTIME_DIR = join(SOGGFY_HOME, "runtime")');
  expect(instanceSource).toContain('this.socketPath = join(RUNTIME_DIR');
  expect(instanceSource).toContain('this.savePath = join(RUNTIME_DIR');
  expect(instanceSource).not.toContain('/tmp/soggfy_instance_');
  expect(instanceSource).not.toContain('/tmp/Soggfy_instance_');
});


test("setup and doctor use the tracked exact-version compatibility registry", () => {
  expect(setup).toContain('compatibility/spotify-versions.json');
  expect(setup).not.toContain('SUPPORTED_SPOTIFY_VERSION="1.2.98.301"');
  expect(setup).toContain('isSpotifyVersionSupported');
  expect(doctor).toContain('isSpotifyVersionSupported');
  expect(doctor).toContain('supportedSpotifyVersions');
  expect(doctor).toContain('workspace:version');
});


test("explicit SOGGFY_HOME isolates shared runtime socket and save paths", () => {
  const customHome = `/tmp/soggfy-isolated-${process.pid}`;
  const script = `import { IPC_SOCKET, SAVE_PATH } from ${JSON.stringify(join(root, "src/core/paths.ts"))}; console.log(JSON.stringify({ IPC_SOCKET, SAVE_PATH }));`;
  const env = { ...process.env };
  delete env.SOGGFY_SOCKET_PATH;
  delete env.SOGGFY_SAVE_PATH;
  env.SOGGFY_HOME = customHome;
  const result = Bun.spawnSync([process.execPath, "-e", script], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual({
    IPC_SOCKET: join(customHome, "runtime", "spotify.sock"),
    SAVE_PATH: join(customHome, "runtime", "spotify"),
  });
});
