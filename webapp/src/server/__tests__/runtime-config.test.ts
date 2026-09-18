import { expect, test } from "bun:test";
import { intFromEnv, prefetchModeFromEnv, strictBooleanEnv } from "../runtime-config";

test("integer environment parsing falls back for malformed values", () => {
  expect(intFromEnv(undefined, 7)).toBe(7);
  expect(intFromEnv("", 7)).toBe(7);
  expect(intFromEnv("not-a-number", 7)).toBe(7);
  expect(intFromEnv("12", 7)).toBe(12);
});


test("strict boolean environment parsing accepts only 0 and 1", () => {
  expect(strictBooleanEnv("X", undefined, false)).toBe(false);
  expect(strictBooleanEnv("X", "", true)).toBe(true);
  expect(strictBooleanEnv("X", "0", true)).toBe(false);
  expect(strictBooleanEnv("X", "1", false)).toBe(true);
  expect(() => strictBooleanEnv("X", "true")).toThrow("X must be exactly 0 or 1");
});


test("prefetch defaults off and preserves explicit opt-out/opt-in", () => {
  expect(prefetchModeFromEnv(undefined)).toBe("off");
  expect(prefetchModeFromEnv("")).toBe("off");
  expect(prefetchModeFromEnv("0")).toBe("off");
  expect(prefetchModeFromEnv("1")).toBe("on");
  expect(() => prefetchModeFromEnv("true")).toThrow("SOGGFY_PREFETCH must be exactly 0 or 1 when set");
});
