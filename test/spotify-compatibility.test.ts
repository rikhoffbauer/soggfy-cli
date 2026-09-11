import { expect, test } from "bun:test";
import {
  compareSpotifyVersions,
  isSpotifyVersionSupported,
  supportedSpotifySpan,
  supportedSpotifyVersions,
  upsertCompatibilityEntry,
  latestSupportedSpotifyVersion,
  type SpotifyCompatibilityRegistry,
} from "../src/core/spotify-compatibility";

test("production support is exact even inside the observed version span", () => {
  expect(supportedSpotifyVersions()).toContain("1.2.98.301");
  expect(isSpotifyVersionSupported("1.2.98.301")).toBe(true);
  expect(isSpotifyVersionSupported("1.2.99.317")).toBe(true);
  expect(isSpotifyVersionSupported("1.2.98.302")).toBe(false);
  expect(supportedSpotifySpan()).toEqual({ min: "1.2.98.301", max: "1.2.99.317" });
});

test("Spotify dotted versions sort numerically rather than lexicographically", () => {
  expect(compareSpotifyVersions("1.2.99.9", "1.2.99.10")).toBeLessThan(0);
  expect(compareSpotifyVersions("1.2.100.1", "1.2.99.999")).toBeGreaterThan(0);
  expect(compareSpotifyVersions("1.2.98.301", "1.2.98.301")).toBe(0);
});
test("registry updates replace exact versions and remain deterministically sorted", () => {
  const registry: SpotifyCompatibilityRegistry = {
    schemaVersion: 1,
    versions: [
      { version: "1.2.100.1", architecture: "arm64", status: "failed", validatedAt: "2026-09-08T00:00:00Z", commit: "a", checks: {} },
      { version: "1.2.98.301", architecture: "arm64", status: "supported", validatedAt: "2026-09-08T00:00:00Z", commit: "a", checks: {} },
    ],
  };
  const updated = upsertCompatibilityEntry(registry, {
    version: "1.2.99.317", architecture: "arm64", status: "supported",
    validatedAt: "2026-09-08T01:00:00Z", commit: "b", checks: { ipc: true },
  });
  expect(updated.versions.map((entry) => entry.version)).toEqual(["1.2.98.301", "1.2.99.317", "1.2.100.1"]);

  const replaced = upsertCompatibilityEntry(updated, {
    version: "1.2.99.317", architecture: "arm64", status: "failed",
    validatedAt: "2026-09-08T02:00:00Z", commit: "c", checks: { ipc: false }, failureReason: "probe failed",
  });
  expect(replaced.versions).toHaveLength(3);
  expect(replaced.versions[1]?.status).toBe("failed");
  expect(replaced.versions[1]?.commit).toBe("c");
});


test("an empty registry has no latest supported version instead of throwing", () => {
  const empty: SpotifyCompatibilityRegistry = { schemaVersion: 1, versions: [] };
  expect(latestSupportedSpotifyVersion(empty)).toBeNull();
});
