import { test, expect } from "bun:test";
import { getFingerprint } from "../src/core/fingerprint";
import { existsSync } from "fs";

test("getFingerprint returns raw chromaprint output for audio file", () => {
  const sampleFile = "/tmp/Soggfy_cli/5FFVCYuBDztqDMWDrqAJAo.wav";
  if (!existsSync(sampleFile)) {
    console.log("Skipping fingerprint test: sample file not present");
    return;
  }

  const result = getFingerprint(sampleFile, 240);
  expect(result).not.toBeNull();
  expect(typeof result?.fingerprint).toBe("string");
  expect(result?.fingerprint.length).toBeGreaterThan(10);
  // Chromaprint raw output is comma-separated integers
  expect(result?.fingerprint).toMatch(/^[0-9,-]+$/);
});
