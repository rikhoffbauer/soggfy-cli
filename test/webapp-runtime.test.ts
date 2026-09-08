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
