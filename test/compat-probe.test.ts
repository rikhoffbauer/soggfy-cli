import { expect, test } from "bun:test";
import { compatibilityEntryFromProbe, createCompatibilityRunPaths } from "../src/core/compat-probe";

const successful = {
  version: "1.2.99.317",
  architecture: "arm64" as const,
  runDir: "/tmp/run",
  commit: "abc123",
  startedAt: "2026-09-08T00:00:00.000Z",
  validatedAt: "2026-09-08T00:01:00.000Z",
  checks: {
    patching: true, signing: true, processLaunch: true, ipc: true,
    decoderHooks: true, playback: true, capture: true, mediaValidation: true, headless: true,
  },
};

test("successful probe records exact version support", () => {
  expect(compatibilityEntryFromProbe(successful)).toMatchObject({
    version: "1.2.99.317",
    architecture: "arm64",
    status: "supported",
    commit: "abc123",
  });
});

test("any failed mandatory check records the candidate as failed", () => {
  const result = structuredClone(successful);
  result.checks.decoderHooks = false;
  expect(compatibilityEntryFromProbe({ ...result, failureReason: "decoder hooks unavailable" })).toMatchObject({
    status: "failed",
    failureReason: "decoder hooks unavailable",
  });
});

test("probe paths stay isolated from system and production patched Spotify", () => {
  const paths = createCompatibilityRunPaths("/tmp/soggfy-compat-run");
  expect(paths.appPath).toBe("/tmp/soggfy-compat-run/PatchedSpotify.app");
  expect(paths.savePath).toBe("/tmp/soggfy-compat-run/save");
  expect(paths.profileDir).toBe("/tmp/soggfy-compat-run/profile");
  expect(paths.appPath).not.toBe("/Applications/Spotify.app");
  expect(paths.appPath).not.toContain("/.soggfy/workspace/PatchedSpotify.app");
});
