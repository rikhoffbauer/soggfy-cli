import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { exportAuthSnapshot, importAuthSnapshot } from "../src/core/auth-state";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("auth snapshot round-trips nested runtime session state without escaping its root", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-auth-owned-")); roots.push(root);
  const source = join(root, "source"); const dest = join(root, "dest");
  mkdirSync(join(source, "PersistentCache/Users/u"), { recursive: true });
  writeFileSync(join(source, "prefs"), 'autologin.username="rik"\n');
  writeFileSync(join(source, "PersistentCache/Users/u/session"), "session");
  const snapshot = exportAuthSnapshot(source);
  expect(Object.keys(snapshot.files).sort()).toEqual(["PersistentCache/Users/u/session", "prefs"]);
  importAuthSnapshot(dest, snapshot);
  expect(readFileSync(join(dest, "PersistentCache/Users/u/session"), "utf8")).toBe("session");
  expect(existsSync(join(root, "escape"))).toBe(false);
});