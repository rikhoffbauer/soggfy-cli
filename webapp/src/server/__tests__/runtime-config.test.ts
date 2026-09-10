import { expect, test } from "bun:test";
import { intFromEnv } from "../runtime-config";

test("integer environment parsing falls back for malformed values", () => {
  expect(intFromEnv(undefined, 7)).toBe(7);
  expect(intFromEnv("", 7)).toBe(7);
  expect(intFromEnv("not-a-number", 7)).toBe(7);
  expect(intFromEnv("12", 7)).toBe(12);
});
