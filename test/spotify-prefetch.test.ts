import { expect, test } from "bun:test";
import {
  derivePrefetchPolicy,
  parseStorageResolveUrls,
  rangesCoverFile,
  selectPrefetchVariant,
} from "../src/core/spotify-prefetch";

function varint(value: number): number[] {
  let v = BigInt(value);
  const out: number[] = [];
  while (v > 0x7fn) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

function stringField(field: number, value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
}

test("storage resolve parser returns only field-2 URLs", () => {
  const payload = new Uint8Array([
    ...stringField(1, "ignored"),
    ...stringField(2, "https://audio.example/a"),
    ...stringField(2, "https://audio.example/b"),
  ]);
  expect(parseStorageResolveUrls(payload)).toEqual([
    "https://audio.example/a",
    "https://audio.example/b",
  ]);
});

test("storage resolve parser fails closed on malformed fields", () => {
  expect(() => parseStorageResolveUrls(new Uint8Array([0x12, 0x05, 0x61]))).toThrow();
  expect(() => parseStorageResolveUrls(new Uint8Array([0x0d, 0, 0, 0, 0]))).toThrow();
});

test("prefetch policy is derived from the exact currently selected file", () => {
  const files = [
    { fileId: "a".repeat(40), formatEnum: 0, bitrate: 96_000 },
    { fileId: "b".repeat(40), formatEnum: 1, bitrate: 160_000 },
    { fileId: "c".repeat(40), formatEnum: 2, bitrate: 320_000 },
  ];
  expect(derivePrefetchPolicy(files, "b".repeat(40))).toEqual({ formatEnum: 1, bitrate: 160_000 });
  expect(derivePrefetchPolicy(files, "d".repeat(40))).toBeNull();
});

test("future variant selection requires one exact format and bitrate match", () => {
  const trackUri = "spotify:track:4PTG3Z6ehGkBFwjybzWkR8";
  const files = [
    { fileId: "a".repeat(40), formatEnum: 1, bitrate: 160_000 },
    { fileId: "b".repeat(40), formatEnum: 2, bitrate: 320_000 },
  ];
  expect(selectPrefetchVariant(trackUri, files, { formatEnum: 1, bitrate: 160_000 })).toEqual({
    trackUri,
    fileId: "a".repeat(40),
    formatEnum: 1,
    bitrate: 160_000,
  });
  expect(selectPrefetchVariant(trackUri, [...files, { fileId: "c".repeat(40), formatEnum: 1, bitrate: 160_000 }], { formatEnum: 1, bitrate: 160_000 })).toBeNull();
});

test("range coverage accepts overlap but rejects gaps and incomplete tails", () => {
  expect(rangesCoverFile([{ start: 0, end: 50 }, { start: 40, end: 100 }], 100)).toBe(true);
  expect(rangesCoverFile([{ start: 0, end: 49 }, { start: 50, end: 100 }], 100)).toBe(false);
  expect(rangesCoverFile([{ start: 0, end: 99 }], 100)).toBe(false);
  expect(rangesCoverFile([{ start: 1, end: 100 }], 100)).toBe(false);
});
