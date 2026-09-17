import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { retainStandaloneCapture, shouldRemoveCaptureAfterOutput } from "../src/commands/download";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("failed output processing preserves a validated capture for retry", () => {
  expect(shouldRemoveCaptureAfterOutput({
    keepCapture: false,
    outputSucceeded: false,
  })).toBe(false);
});

test("successful output processing removes the capture unless explicitly kept", () => {
  expect(shouldRemoveCaptureAfterOutput({
    keepCapture: false,
    outputSucceeded: true,
  })).toBe(true);
  expect(shouldRemoveCaptureAfterOutput({
    keepCapture: true,
    outputSucceeded: true,
  })).toBe(false);
});

test("retained standalone capture survives deletion of the temporary runtime tree", () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-download-retain-"));
  roots.push(root);
  const tempRoot = join(root, "runtime");
  const retainedRoot = join(root, "retained");
  const saveRoot = join(tempRoot, "save");
  mkdirSync(saveRoot, { recursive: true });
  const source = join(saveRoot, "4PTG3Z6ehGkBFwjybzWkR8.ogg");
  writeFileSync(source, "OggS-fixture");

  const retained = retainStandaloneCapture(source, "4PTG3Z6ehGkBFwjybzWkR8", retainedRoot);
  rmSync(tempRoot, { recursive: true, force: true });

  expect(existsSync(retained)).toBe(true);
  expect(existsSync(source)).toBe(false);
});
