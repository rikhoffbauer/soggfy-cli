import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createAudioFixture, verifyAudioFixture } from "../src/core/audio-fixture";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "soggfy-audio-fixture-"));
  roots.push(root);
  return root;
}

function writeFloatWav(path: string, frequency = 440): void {
  const sampleRate = 44_100;
  const channels = 2;
  const frames = sampleRate;
  const dataBytes = frames * channels * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 4, 28);
  buffer.writeUInt16LE(channels * 4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame++) {
    const sample = Math.sin((2 * Math.PI * frequency * frame) / sampleRate) * 0.25;
    for (let channel = 0; channel < channels; channel++) {
      buffer.writeFloatLE(sample, 44 + (frame * channels + channel) * 4);
    }
  }
  writeFileSync(path, buffer);
}

test("whole-track fixture accepts the exact captured file", () => {
  const path = join(makeRoot(), "fixture.wav");
  writeFloatWav(path);
  const fixture = createAudioFixture(path, "fixture-track");
  const result = verifyAudioFixture(path, fixture);
  expect(result.ok).toBe(true);
  expect(result.exactFileMatch).toBe(true);
  expect(result.decodedPcmMatch).toBe(true);
  expect(fixture.file.bytes).toBeGreaterThan(44);
  expect(fixture.file.sha256).toHaveLength(64);
  expect(fixture.decodedPcm.sha256).toHaveLength(64);
});

test("whole-track fixture rejects a different complete audio file", () => {
  const root = makeRoot();
  const reference = join(root, "reference.wav");
  const candidate = join(root, "candidate.wav");
  writeFloatWav(reference, 440);
  writeFloatWav(candidate, 880);
  const fixture = createAudioFixture(reference, "fixture-track");
  const result = verifyAudioFixture(candidate, fixture);
  expect(result.ok).toBe(false);
  expect(result.exactFileMatch).toBe(false);
  expect(result.decodedPcmMatch).toBe(false);
});
