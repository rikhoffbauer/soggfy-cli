import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createServer } from "node:net";
import { PATCHED_APP } from "../src/core/paths";
import {
  isLoopbackPortAvailable,
  managedStandaloneProfileDirs,
  SpotifyInstance,
  spotifyInstanceCompatibilityEnvironment,
} from "../src/core/instance";

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
  const orphanCheck = source.indexOf("await this.retireOrphanedProfile(binaryPath, this.profileDir");
  const spawn = source.indexOf("this.process = spawn");
  expect(source).toContain('orphanInspection.kind === "unverifiable"');
  expect(source).toContain("cannot verify or terminate it safely");
  expect(orphanCheck).toBeGreaterThan(-1);
  expect(spawn).toBeGreaterThan(orphanCheck);
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
  const orphanCheck = source.indexOf("await this.retireOrphanedProfile(binaryPath, this.profileDir");
  const spawn = source.indexOf("this.process = spawn");
  expect(source).toContain('orphanInspection.kind === "unavailable"');
  expect(orphanCheck).toBeGreaterThan(-1);
  expect(spawn).toBeGreaterThan(orphanCheck);
});

test("SpotifyInstance can expose a dedicated loopback renderer debug port for authenticated library access", () => {
  const instance = new SpotifyInstance("/tmp/auth.sock", "/tmp/auth-save", "/tmp/auth-profile", {
    debugPort: 19224,
  });
  expect(instance.debugPort).toBe(19224);
  expect(source).toContain('`--remote-debugging-port=${this.debugPort}`');
});

test("loopback port probe rejects a listener already owned by another process", async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    expect(await isLoopbackPortAvailable(address.port)).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
});

test("SpotifyInstance refuses conflicting Spotify control listeners unless explicitly overridden", () => {
  expect(source).toContain("isLoopbackPortAvailable(7768)");
  expect(source).toContain('SOGGFY_ALLOW_CONCURRENT_SPOTIFY !== "1"');
  expect(source).toContain("Spotify local control port 7768 is already owned");
});

test("managedStandaloneProfileDirs returns only Soggfy standalone runtime profiles in numeric order", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-profiles-"));
  try {
    for (const name of ["instance_10", "cli_instance", "instance_2", "instance_bad", "instance_1"]) {
      mkdirSync(join(root, name));
    }
    expect(managedStandaloneProfileDirs(root)).toEqual([
      join(root, "instance_1"),
      join(root, "instance_2"),
      join(root, "instance_10"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("daemon-profile SpotifyInstance retires orphaned standalone runtimes before spawning", () => {
  const standaloneScan = source.indexOf("managedStandaloneProfileDirs()");
  const spawn = source.indexOf("this.process = spawn");
  expect(standaloneScan).toBeGreaterThan(-1);
  expect(spawn).toBeGreaterThan(standaloneScan);
});
