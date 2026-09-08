import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const source = readFileSync(join(import.meta.dir, "../webapp/src/index.ts"), "utf8");

test("webapp Spotify instances isolate temp, cache, profile, and runtime state", () => {
  expect(source).toContain('TMPDIR: tmpDir');
  expect(source).toContain('`--cache-path=${this.profileDir}`');
  expect(source).toContain('`--user-data-dir=${this.profileDir}`');
  expect(source).toContain('this.socketPath = join(RUNTIME_DIR');
  expect(source).toContain('this.savePath = join(RUNTIME_DIR');
});

test("webapp readiness fails immediately when the launched process exits", () => {
  expect(source).toContain('try { process.kill(this.process.pid, 0); }');
  expect(source).toContain('catch { return false; }');
});

test("webapp uses the shared Spotify input resolver so unavailable track IDs are relinked", () => {
  expect(source).toContain('resolveInput as resolveSpotifyInput');
  expect(source).toContain('return resolveSpotifyInput(input);');
});

test("stream route resolves unavailable track IDs before looking up or queuing output", () => {
  const start = source.indexOf('"/api/stream"');
  const end = source.indexOf('"/api/download"', start);
  const streamRoute = source.slice(start, end);
  expect(streamRoute).toContain("const resolvedTrackIds = await resolveSpotifyInput(trackParam);");
  expect(streamRoute).toContain("const trackId = resolvedTrackIds[0];");
});
