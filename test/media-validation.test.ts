import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateAudioFile } from "../src/core/media";
import { streamToWriter, transcode } from "../src/core/transcode";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "soggfy-media-"));
  roots.push(root);
  return root;
}

function writeFloatWav(path: string, durationMs = 1000, silent = false): void {
  const sampleRate = 44_100;
  const channels = 2;
  const frames = Math.round((sampleRate * durationMs) / 1000);
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

  if (!silent) {
    for (let frame = 0; frame < frames; frame++) {
      const sample = Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 0.25;
      for (let channel = 0; channel < channels; channel++) {
        buffer.writeFloatLE(sample, 44 + (frame * channels + channel) * 4);
      }
    }
  }
  writeFileSync(path, buffer);
}

test("validateAudioFile accepts a healthy float WAV", () => {
  const path = join(makeRoot(), "healthy.wav");
  writeFloatWav(path);
  const result = validateAudioFile(path, 1000);
  expect(result.ok).toBe(true);
  expect(result.ffprobeOk).toBe(true);
  expect(result.peak).toBeGreaterThan(0.1);
});

test("validateAudioFile rejects silent and wrong-duration captures", () => {
  const root = makeRoot();
  const silent = join(root, "silent.wav");
  const short = join(root, "short.wav");
  writeFloatWav(silent, 1000, true);
  writeFloatWav(short, 1000, false);

  const silentResult = validateAudioFile(silent, 1000);
  const shortResult = validateAudioFile(short, 10_000);

  expect(silentResult.ok).toBe(false);
  expect(silentResult.warnings).toContain("near_silent_peak");
  expect(shortResult.ok).toBe(false);
  expect(shortResult.warnings.some((w) => w.startsWith("unexpected_duration"))).toBe(true);
});

test("validateAudioFile rejects malformed media", () => {
  const path = join(makeRoot(), "broken.wav");
  writeFileSync(path, Buffer.from("not a wav file"));
  const result = validateAudioFile(path);
  expect(result.ok).toBe(false);
  expect(result.ffprobeOk).toBe(false);
});

test("raw output refuses compressed captures and WAV streaming transcodes them", async () => {
  const root = makeRoot();
  const wav = join(root, "source.wav");
  const ogg = join(root, "source.ogg");
  const raw = join(root, "source.raw");
  writeFloatWav(wav);
  const encoded = Bun.spawnSync([
    "ffmpeg", "-y", "-v", "error", "-i", wav, "-c:a", "vorbis", "-strict", "-2", ogg,
  ]);
  expect(encoded.exitCode).toBe(0);

  expect(transcode(ogg, raw, "raw")).toBe(false);

  const chunks: Uint8Array[] = [];
  const writer = new WritableStream<Uint8Array>({
    write(chunk) { chunks.push(chunk.slice()); },
  });
  await streamToWriter(ogg, writer, "wav");
  const output = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  expect(output.subarray(0, 4).toString("ascii")).toBe("RIFF");
});
