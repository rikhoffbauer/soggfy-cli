import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { capturedBytesFromPath } from "../spotify-instance";

let root: string | null = null;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

test("captured byte polling tolerates a file disappearing before stat", () => {
  expect(capturedBytesFromPath("/definitely/missing/soggfy-capture.ogg", 77)).toBe(77);
  root = mkdtempSync(join(tmpdir(), "soggfy-bytes-"));
  const wav = join(root, "capture.wav");
  writeFileSync(wav, Buffer.alloc(100));
  expect(capturedBytesFromPath(wav, 0)).toBe(56);
});
