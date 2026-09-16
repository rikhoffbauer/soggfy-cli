import { expect, test } from "bun:test";
import { parseCompatArgs, formatCompatibilityList } from "../src/commands/compat";
import type { SpotifyCompatibilityRegistry } from "../src/core/spotify-compatibility";

const trackId = "4PTG3Z6ehGkBFwjybzWkR8";

test("compat probe parses candidate path and validation options", () => {
  expect(parseCompatArgs(["probe", "/tmp/Spotify.app", "--track", trackId, "--fixture", "/tmp/reference.json", "--record", "--keep", "--json"])).toEqual({
    action: "probe",
    appPath: "/tmp/Spotify.app",
    trackId,
    fixturePath: "/tmp/reference.json",
    record: true,
    keep: true,
    json: true,
  });
});

test("compat fixture builds a whole-track reference manifest from a known-good capture", () => {
  expect(parseCompatArgs(["fixture", "/tmp/reference.ogg", "--track", trackId, "--output", "/tmp/reference.json", "--json"])).toEqual({
    action: "fixture",
    audioPath: "/tmp/reference.ogg",
    trackId,
    outputPath: "/tmp/reference.json",
    json: true,
  });
});

test("compat probe defaults to system Spotify and a stable smoke track", () => {
  const parsed = parseCompatArgs(["probe"]);
  expect(parsed.appPath).toBe("/Applications/Spotify.app");
  expect(parsed.trackId).toBe(trackId);
  expect(parsed.record).toBe(false);
  expect(parsed.keep).toBe(false);
});

test("compat list reports exact support and observed span without implying range support", () => {
  const registry: SpotifyCompatibilityRegistry = {
    schemaVersion: 1,
    versions: [
      { version: "1.2.98.301", architecture: "arm64", status: "supported", validatedAt: "2026-09-01T00:00:00.000Z", commit: "a", checks: {} },
      { version: "1.2.99.317", architecture: "arm64", status: "supported", validatedAt: "2026-09-08T00:00:00.000Z", commit: "b", checks: {} },
    ],
  };
  const output = formatCompatibilityList(registry, false);
  expect(output).toContain("1.2.98.301");
  expect(output).toContain("1.2.99.317");
  expect(output).toContain("Observed supported span: 1.2.98.301 – 1.2.99.317");
  expect(output).toContain("Unrecorded versions remain unsupported");
});

test("compat rejects unknown actions and options", () => {
  expect(() => parseCompatArgs(["wat"])).toThrow("Unsupported compat action");
  expect(() => parseCompatArgs(["probe", "--wat"])).toThrow("Unknown compat option");
});
