import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getFingerprint } from "../src/core/fingerprint";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeSineWav(path: string, seconds = 3): void {
  const sampleRate = 44_100;
  const samples = sampleRate * seconds;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    buffer.writeInt16LE(Math.round(sample * 0x3fff), 44 + i * 2);
  }
  writeFileSync(path, buffer);
}

test("getFingerprint fingerprints a deterministic generated WAV", () => {
  expect(Bun.which("fpcalc")).not.toBeNull();
  const root = mkdtempSync(join(tmpdir(), "soggfy-fingerprint-"));
  roots.push(root);
  const sampleFile = join(root, "tone.wav");
  writeSineWav(sampleFile);

  const result = getFingerprint(sampleFile, 240);
  expect(result).not.toBeNull();
  expect(typeof result?.fingerprint).toBe("string");
  expect(result?.fingerprint.length).toBeGreaterThan(10);
  expect(result?.fingerprint).toMatch(/^[0-9,-]+$/);
});
