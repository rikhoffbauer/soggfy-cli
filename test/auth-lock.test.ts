import { afterEach, expect, test } from "bun:test";
import { closeSync, constants, existsSync, mkdtempSync, openSync, rmSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { acquireAuthStateLock } from "../src/core/auth-lock";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("auth state lock excludes a concurrent live owner and can be reacquired after release", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-auth-lock-"));
  roots.push(root);
  const path = join(root, ".state.lock");
  const first = acquireAuthStateLock(path);
  expect(() => acquireAuthStateLock(path)).toThrow("Auth state is busy");
  first.release();
  const second = acquireAuthStateLock(path);
  second.release();
});

test("an auth lock cannot be stolen before its owner writes diagnostic state", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-auth-lock-"));
  roots.push(root);
  const path = join(root, ".state.lock");
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NONBLOCK | 0x20, 0o600);
  try {
    expect(() => acquireAuthStateLock(path)).toThrow("Auth state is busy");
  } finally {
    closeSync(fd);
  }
});

test("releasing an old auth lock cannot remove a replacement owner's lock", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-auth-lock-"));
  roots.push(root);
  const path = join(root, ".state.lock");
  const first = acquireAuthStateLock(path);
  unlinkSync(path);
  const second = acquireAuthStateLock(path);
  try {
    first.release();
    expect(existsSync(path)).toBe(true);
    expect(() => acquireAuthStateLock(path)).toThrow("Auth state is busy");
  } finally {
    first.release();
    second.release();
  }
});

test("auth locks recover after an owner exits without releasing", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-auth-lock-"));
  roots.push(root);
  const path = join(root, ".state.lock");
  const proc = Bun.spawn([process.execPath, "-e", 'import {acquireAuthStateLock} from "./src/core/auth-lock"; acquireAuthStateLock(process.env.TEST_AUTH_LOCK);'], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, TEST_AUTH_LOCK: path },
    stdout: "ignore", stderr: "pipe",
  });
  expect(await proc.exited).toBe(0);
  const lock = acquireAuthStateLock(path);
  lock.release();
});
