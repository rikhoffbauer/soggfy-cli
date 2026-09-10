import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { replaceDirectoryAtomically } from "../src/core/atomic-directory";

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

test("atomic replacement commits staged directory and removes backup", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-atomic-"));
  roots.push(root);
  const current = join(root, "PatchedSpotify.app");
  const staged = join(root, ".PatchedSpotify.app.staged");
  mkdirSync(current);
  mkdirSync(staged);
  writeFileSync(join(current, "version"), "old");
  writeFileSync(join(staged, "version"), "new");

  replaceDirectoryAtomically(staged, current);

  expect(readFileSync(join(current, "version"), "utf8")).toBe("new");
  expect(existsSync(staged)).toBe(false);
  expect(existsSync(`${current}.backup`)).toBe(false);
});
