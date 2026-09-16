import { expect, test } from "bun:test";
import {
  assertCompatibilityProbeRecordSafety,
  compatibilityEntryFromProbe,
  compatibilityProbeInstanceOptions,
  createCompatibilityRunPaths,
  isFacelessLaunchInfo,
} from "../src/core/compat-probe";

const successful = {
  version: "1.2.99.317",
  architecture: "arm64" as const,
  runDir: "/tmp/run",
  commit: "abc123",
  startedAt: "2026-09-08T00:00:00.000Z",
  validatedAt: "2026-09-08T00:01:00.000Z",
  checks: {
    patching: true, signing: true, processLaunch: true, ipc: true,
    decoderHooks: true, playback: true, capture: true, mediaValidation: true, audioFixture: true, headless: true,
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

test("whole-track audio fixture is a mandatory compatibility check", () => {
  const result = structuredClone(successful);
  result.checks.audioFixture = false;
  expect(compatibilityEntryFromProbe({ ...result, failureReason: "audio fixture mismatch" })).toMatchObject({
    status: "failed",
    failureReason: "audio fixture mismatch",
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


test("compatibility probes can pass discovered targets only to an isolated instance", () => {
  const targets = { family: "OggV1" as const, decodeAudioDataOffset: 0x13183ac, oggStreamPageinOffset: 0x134cf10 };
  expect(compatibilityProbeInstanceOptions("/tmp/Candidate.app", "1.3.1.123", targets)).toEqual({
    appPath: "/tmp/Candidate.app",
    enforceSupportedVersion: false,
    compatibilityHookTargets: { version: "1.3.1.123", targets },
  });
});

test("temporary discovered targets cannot be recorded as production support directly", () => {
  expect(() => assertCompatibilityProbeRecordSafety({
    appPath: "/tmp/Candidate.app", trackId: "x", record: true, keep: false, json: false,
    compatibilityHookTargets: { family: "OggV1", decodeAudioDataOffset: 1, oggStreamPageinOffset: 2 },
  })).toThrow("temporary discovered hook targets");
});

test("headless verification recognizes lsappinfo faceless registration without compiling Swift", () => {
  expect(isFacelessLaunchInfo('ASN:0x0-0x0: "Spotify" ASN:0x0-0x0: pid=123 !cgsConnection')).toBe(true);
  expect(isFacelessLaunchInfo('ASN:0x0-0x0: "Spotify" ASN:0x0-0x0: pid=123')).toBe(false);
});
