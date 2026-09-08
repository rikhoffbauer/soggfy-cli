import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const setup = readFileSync(join(root, "setup.sh"), "utf8");
const doctor = readFileSync(join(root, "scripts/doctor.ts"), "utf8");
const webapp = readFileSync(join(root, "webapp/src/index.ts"), "utf8");

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


test("setup terminates only the login process tree it launches", () => {
  expect(setup).toContain('SPOTIFY_LOGIN_PID=$!');
  expect(setup).toContain('terminate_process_tree "$SPOTIFY_LOGIN_PID"');
  expect(setup).not.toContain('killall Spotify');
});


test("webapp runtime state is scoped under the shared SOGGFY_HOME", () => {
  expect(webapp).toContain('const RUNTIME_DIR = join(SOGGFY_HOME, "runtime")');
  expect(webapp).toContain('this.socketPath = join(RUNTIME_DIR');
  expect(webapp).toContain('this.savePath = join(RUNTIME_DIR');
  expect(webapp).not.toContain('/tmp/soggfy_instance_');
  expect(webapp).not.toContain('/tmp/Soggfy_instance_');
});


test("setup and doctor use the tracked exact-version compatibility registry", () => {
  expect(setup).toContain('compatibility/spotify-versions.json');
  expect(setup).not.toContain('SUPPORTED_SPOTIFY_VERSION="1.2.98.301"');
  expect(setup).toContain('isSpotifyVersionSupported');
  expect(doctor).toContain('isSpotifyVersionSupported');
  expect(doctor).toContain('supportedSpotifyVersions');
  expect(doctor).toContain('workspace:version');
});
