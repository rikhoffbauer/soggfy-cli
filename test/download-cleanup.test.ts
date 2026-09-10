import { expect, test } from "bun:test";
import { shouldRemoveCaptureAfterOutput } from "../src/commands/download";

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
