import registryJson from "../../compatibility/spotify-versions.json" with { type: "json" };

export type SpotifyCompatibilityStatus = "supported" | "failed";

export interface SpotifyCompatibilityChecks {
  patching?: boolean;
  signing?: boolean;
  processLaunch?: boolean;
  ipc?: boolean;
  decoderHooks?: boolean;
  playback?: boolean;
  capture?: boolean;
  mediaValidation?: boolean;
  headless?: boolean;
}

export interface SpotifyCompatibilityEntry {
  version: string;
  architecture: "arm64";
  status: SpotifyCompatibilityStatus;
  validatedAt: string;
  commit: string;
  checks: SpotifyCompatibilityChecks;
  failureReason?: string;
  notes?: string;
}

export interface SpotifyCompatibilityRegistry {
  schemaVersion: 1;
  versions: SpotifyCompatibilityEntry[];
}
export const SPOTIFY_COMPATIBILITY_REGISTRY = registryJson as SpotifyCompatibilityRegistry;

function versionParts(version: string): number[] {
  return version.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

export function compareSpotifyVersions(a: string, b: string): number {
  const aa = versionParts(a);
  const bb = versionParts(b);
  const width = Math.max(aa.length, bb.length);
  for (let i = 0; i < width; i++) {
    const delta = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function supportedSpotifyVersions(
  registry: SpotifyCompatibilityRegistry = SPOTIFY_COMPATIBILITY_REGISTRY,
): string[] {
  return registry.versions
    .filter((entry) => entry.architecture === "arm64" && entry.status === "supported")
    .map((entry) => entry.version)
    .sort(compareSpotifyVersions);
}

export function isSpotifyVersionSupported(
  version: string,
  registry: SpotifyCompatibilityRegistry = SPOTIFY_COMPATIBILITY_REGISTRY,
): boolean {
  return supportedSpotifyVersions(registry).includes(version);
}
export function supportedSpotifySpan(
  registry: SpotifyCompatibilityRegistry = SPOTIFY_COMPATIBILITY_REGISTRY,
): { min: string; max: string } | null {
  const versions = supportedSpotifyVersions(registry);
  if (versions.length === 0) return null;
  return { min: versions[0]!, max: versions[versions.length - 1]! };
}

export function upsertCompatibilityEntry(
  registry: SpotifyCompatibilityRegistry,
  entry: SpotifyCompatibilityEntry,
): SpotifyCompatibilityRegistry {
  const versions = registry.versions
    .filter((existing) => !(existing.version === entry.version && existing.architecture === entry.architecture));
  versions.push(structuredClone(entry));
  versions.sort((a, b) => compareSpotifyVersions(a.version, b.version));
  return { schemaVersion: 1, versions };
}

export function latestSupportedSpotifyVersion(
  registry: SpotifyCompatibilityRegistry = SPOTIFY_COMPATIBILITY_REGISTRY,
): string | null {
  const span = supportedSpotifySpan(registry);
  return span?.max ?? null;
}
