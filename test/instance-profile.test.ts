import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { PATCHED_APP } from "../src/core/paths";
import { SpotifyInstance, spotifyInstanceCompatibilityEnvironment } from "../src/core/instance";

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


test("SpotifyInstance disables discovered hook targets unless explicitly supplied", () => {
  expect(spotifyInstanceCompatibilityEnvironment()).toEqual({
    SOGGFY_COMPAT_ALLOW_DISCOVERED_TARGETS: "0",
  });
});

test("SpotifyInstance can opt an isolated compatibility run into discovered targets", () => {
  expect(spotifyInstanceCompatibilityEnvironment({
    version: "1.3.1.123",
    targets: { family: "OggV1", decodeAudioDataOffset: 0x13183ac, oggStreamPageinOffset: 0x134cf10 },
  })).toMatchObject({
    SOGGFY_COMPAT_ALLOW_DISCOVERED_TARGETS: "1",
    SOGGFY_COMPAT_EXPECTED_VERSION: "1.3.1.123",
    SOGGFY_COMPAT_DECODE_OFFSET: "0x13183ac",
    SOGGFY_COMPAT_OGG_PAGEIN_OFFSET: "0x134cf10",
  });
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


test("SpotifyInstance refuses an exact-profile Spotify process whose identity is unverifiable", () => {
  const guard = source.indexOf("cannot verify or terminate it safely");
  const spawn = source.indexOf("this.process = spawn");
  expect(guard).toBeGreaterThan(-1);
  expect(spawn).toBeGreaterThan(guard);
});


test("SpotifyInstance resets transient save state before cloning login state", () => {
  const reset = source.indexOf("resetSpotifyTransientRuntimeState(this.savePath)");
  const clone = source.indexOf("cloneSpotifyLoginState(appSupportDest");
  const spawn = source.indexOf("this.process = spawn");
  expect(reset).toBeGreaterThan(-1);
  expect(clone).toBeGreaterThan(reset);
  expect(spawn).toBeGreaterThan(clone);
});


test("SpotifyInstance aborts startup when orphan process inspection is unavailable", () => {
  const unavailable = source.indexOf('orphanInspection.kind === "unavailable"');
  const spawn = source.indexOf("this.process = spawn");
  expect(unavailable).toBeGreaterThan(-1);
  expect(spawn).toBeGreaterThan(unavailable);
});
