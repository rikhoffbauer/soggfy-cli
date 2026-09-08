import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  expectedFloatPcmBytes,
  expectedOggBytes,
  findCapturedAudioPath,
  sanitizeFileName,
} from "../media";

const root = join("/tmp", `soggfy-media-test-${process.pid}`);

test("expectedFloatPcmBytes matches 44.1kHz stereo f32", () => {
  expect(expectedFloatPcmBytes(1000)).toBe(44100 * 2 * 4);
});

test("expectedOggBytes models a 320 kbps stream", () => {
  expect(expectedOggBytes(1000)).toBe(40_000);
});

test("findCapturedAudioPath prefers the selected Ogg capture", () => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "track.wav"), "wav");
  writeFileSync(join(root, "track.ogg"), "ogg");
  expect(findCapturedAudioPath(root, "track")).toBe(join(root, "track.ogg"));
  rmSync(root, { recursive: true, force: true });
});

test("sanitizeFileName removes dangerous filename characters", () => {
  expect(sanitizeFileName('A/B:C*D?E"F<G>H|I')).toBe("ABCDEFGHI");
});
