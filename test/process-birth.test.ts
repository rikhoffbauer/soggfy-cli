import { expect, test } from "bun:test";
import { readKernelProcessBirthId } from "../src/core/process-birth";

test("macOS kernel process birth identity is stable and sub-second", () => {
  if (process.platform !== "darwin") return;
  const first = readKernelProcessBirthId(process.pid);
  const second = readKernelProcessBirthId(process.pid);
  expect(first).not.toBeNull();
  expect(second).toBe(first);
  expect(first).toMatch(/^\d+:\d{6}$/);
});
