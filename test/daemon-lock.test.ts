import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { acquireDaemonStartLock } from "../src/core/daemon-lock";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("daemon start lock permits only one concurrent owner", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-daemon-lock-"));
  roots.push(root);
  const path = join(root, "start.lock");
  const first = acquireDaemonStartLock(path);
  try {
    expect(() => acquireDaemonStartLock(path)).toThrow("Daemon start already in progress");
  } finally {
    first.release();
  }
  const second = acquireDaemonStartLock(path);
  second.release();
});

test("daemon start lock recovers once from a stale owner PID", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-daemon-lock-stale-"));
  roots.push(root);
  const path = join(root, "start.lock");
  writeFileSync(path, "2147483647\n");
  const lock = acquireDaemonStartLock(path);
  lock.release();
});
