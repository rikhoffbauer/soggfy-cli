import { expect, test } from "bun:test";
import { spotifyCefSigningStrategy } from "../src/core/spotify-signing";

test("existing Spotify 1.2 signing path remains direct replacement", () => {
  expect(spotifyCefSigningStrategy("1.2.98.301")).toBe("replace-existing");
  expect(spotifyCefSigningStrategy("1.2.99.317")).toBe("replace-existing");
});

test("Spotify 1.3.0.277 removes the CEF signature before ad-hoc signing", () => {
  expect(spotifyCefSigningStrategy("1.3.0.277")).toBe("remove-then-sign");
});

test("unknown versions do not silently opt into the 1.3 signing workaround", () => {
  expect(spotifyCefSigningStrategy("1.3.0.278")).toBe("replace-existing");
});
