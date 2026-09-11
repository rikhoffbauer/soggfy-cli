import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { PATCHED_APP } from "../src/core/paths";
import { SpotifyInstance } from "../src/core/instance";

const source = readFileSync(join(import.meta.dir, "../src/core/instance.ts"), "utf8");

test("SpotifyInstance uses the shared minimal login-state clone", () => {
  expect(source).toContain("cloneSpotifyLoginState(appSupportDest");
  expect(source).toContain('webKitDest: join(homeDir, "Library/WebKit/com.spotify.client")');
  expect(source).not.toContain('join(sourceDir, "PersistentCache")');
  expect(source).not.toContain('["cp", "-R"');
});

test("SpotifyInstance enforces registry support by default", () => {
  const instance = new SpotifyInstance();
  expect(instance.appPath).toBe(PATCHED_APP);
  expect(instance.enforceSupportedVersion).toBe(true);
});

test("compatibility probes may select an isolated candidate app explicitly", () => {
  const instance = new SpotifyInstance("/tmp/candidate.sock", "/tmp/candidate-save", "/tmp/candidate-profile", {
    appPath: "/tmp/CandidateSpotify.app",
    enforceSupportedVersion: false,
  });
  expect(instance.appPath).toBe("/tmp/CandidateSpotify.app");
  expect(instance.enforceSupportedVersion).toBe(false);
});


test("SpotifyInstance does not override Spotify's cache path", () => {
  expect(source).not.toContain("--cache-path=");
  expect(source).toContain("--user-data-dir=");
});


test("SpotifyInstance retires an exact orphaned runtime before spawning a replacement", () => {
  const retire = source.indexOf("retireOrphanSpotifyOwner");
  const spawn = source.indexOf("this.process = spawn");
  expect(retire).toBeGreaterThan(-1);
  expect(spawn).toBeGreaterThan(retire);
});
