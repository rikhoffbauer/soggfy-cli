import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("web capture validates transcoded duration before accepting MP3 output", () => {
  const source = readFileSync(join(import.meta.dir, "../webapp/src/server/spotify-instance.ts"), "utf8");
  expect(source).toContain("validateAudioFile(finalMp3Path, job.durationMs)");
  expect(source).toContain("transcoded output failed validation");
});
