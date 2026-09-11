import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const source = readFileSync(join(import.meta.dir, "../webapp/src/index.ts"), "utf8");
const instanceSource = readFileSync(join(import.meta.dir, "../webapp/src/server/spotify-instance.ts"), "utf8");
const poolSource = readFileSync(join(import.meta.dir, "../webapp/src/server/pool.ts"), "utf8");
const runtimeSource = readFileSync(join(import.meta.dir, "../webapp/src/server/runtime.ts"), "utf8");
const routesSource = readFileSync(join(import.meta.dir, "../webapp/src/server/routes.ts"), "utf8");

test("webapp Spotify instances isolate temp, cache, profile, and runtime state", () => {
  expect(instanceSource).toContain('TMPDIR: tmpDir');
  expect(instanceSource).not.toContain('--cache-path=');
  expect(instanceSource).toContain('`--user-data-dir=${this.profileDir}`');
  expect(instanceSource).toContain('this.socketPath = join(RUNTIME_DIR');
  expect(instanceSource).toContain('this.savePath = join(RUNTIME_DIR');
});

test("webapp readiness fails immediately when the launched process exits", () => {
  expect(instanceSource).toContain('try { process.kill(this.process.pid, 0); }');
  expect(instanceSource).toContain('catch { return false; }');
});

test("webapp uses the shared Spotify input resolver so unavailable track IDs are relinked", () => {
  expect(runtimeSource).toContain('resolveInput as resolveSpotifyInput');
  expect(runtimeSource).toContain('return resolveSpotifyInput(input);');
});

test("stream route resolves unavailable track IDs before looking up or queuing output", () => {
  const start = routesSource.indexOf('"/api/stream"');
  const end = routesSource.indexOf('"/api/download"', start);
  const streamRoute = routesSource.slice(start, end);
  expect(streamRoute).toContain("const resolvedTrackIds = await resolveSpotifyInput(trackParam);");
  expect(streamRoute).toContain("const trackId = resolvedTrackIds[0];");
});

test("webapp jobs canonicalize unavailable track IDs before queueing", () => {
  const start = poolSource.indexOf("  async addJob(trackParam: string)");
  const end = poolSource.indexOf("  async playNow(", start);
  const addJob = poolSource.slice(start, end);
  expect(poolSource).toContain("resolvePlayableTrackId");
  expect(addJob).toContain("await resolvePlayableTrackId(requestedTrackId)");
  expect(addJob).toContain("return this.addResolvedJob(");
  expect(addJob).toContain("resolution.trackId");
});

test("webapp download jobs never blindly replay a successfully requested track", () => {
  const start = instanceSource.indexOf("  async downloadJob(job: DownloadJob)");
  const end = instanceSource.indexOf("  private refreshCapturedBytes", start);
  const downloadJob = instanceSource.slice(start, end);
  expect(downloadJob).toContain("requestTrackPlayback");
  expect(downloadJob).toContain("await requestTrackPlayback(");
  expect(downloadJob).not.toContain("re-requested target track playback");
});
