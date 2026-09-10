import { expect, test } from "bun:test";
import { apiRequestInit } from "../../api-auth";

test("web token is attached only to same-origin API requests", () => {
  const same = apiRequestInit("/api/jobs", {}, "secret", "http://host:8085");
  expect(new Headers(same.headers).get("x-soggfy-token")).toBe("secret");
  const external = apiRequestInit("https://example.com/api/jobs", {}, "secret", "http://host:8085");
  expect(new Headers(external.headers).get("x-soggfy-token")).toBeNull();
  const asset = apiRequestInit("/logo.png", {}, "secret", "http://host:8085");
  expect(new Headers(asset.headers).get("x-soggfy-token")).toBeNull();
});