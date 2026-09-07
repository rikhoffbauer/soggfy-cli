import { expect, test } from "bun:test";
import { expectedFloatPcmBytes, sanitizeFileName } from "../media";

test("expectedFloatPcmBytes matches 44.1kHz stereo f32", () => {
  expect(expectedFloatPcmBytes(1000)).toBe(44100 * 2 * 4);
});

test("sanitizeFileName removes dangerous filename characters", () => {
  expect(sanitizeFileName('A/B:C*D?E"F<G>H|I')).toBe("ABCDEFGHI");
});
