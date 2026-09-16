import { SPOTIFY_APP } from "../core/paths";
import {
  SPOTIFY_COMPATIBILITY_REGISTRY,
  supportedSpotifySpan,
  supportedSpotifyVersions,
  type SpotifyCompatibilityRegistry,
} from "../core/spotify-compatibility";
import {
  DEFAULT_COMPAT_TRACK_ID,
  probeSpotifyCompatibility,
  type CompatProbeOptions,
  type CompatibilityProbeResult,
} from "../core/compat-probe";
import { parseTrackId } from "../core/spotify-url";
import { createAudioFixture, defaultAudioFixturePath, writeAudioFixture } from "../core/audio-fixture";

export type CompatArgs =
  | ({ action: "probe" } & CompatProbeOptions)
  | { action: "list"; json: boolean }
  | { action: "fixture"; audioPath: string; trackId: string; outputPath: string; json: boolean };

export function parseCompatArgs(args: string[]): CompatArgs {
  const action = args[0];
  if (action !== "probe" && action !== "list" && action !== "fixture") {
    throw new Error(`Unsupported compat action: ${action ?? "missing"}`);
  }

  if (action === "list") {
    if (args.slice(1).some((arg) => arg !== "--json")) throw new Error("Unknown compat option");
    return { action, json: args.includes("--json") };
  }

  if (action === "fixture") {
    const audioPath = args[1];
    if (!audioPath || audioPath.startsWith("-")) {
      throw new Error("compat fixture requires a captured audio file path");
    }
    let trackId = DEFAULT_COMPAT_TRACK_ID;
    let outputPath: string | undefined;
    let json = false;
    for (let i = 2; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--track") {
        const raw = args[++i];
        if (!raw) throw new Error("--track requires a Spotify track ID, URI, or URL");
        const parsed = parseTrackId(raw);
        if (!parsed) throw new Error(`Invalid Spotify track: ${raw}`);
        trackId = parsed;
      } else if (arg === "--output") {
        outputPath = args[++i];
        if (!outputPath) throw new Error("--output requires a path");
      } else if (arg === "--json") json = true;
      else throw new Error(`Unknown compat option: ${arg}`);
    }
    return {
      action,
      audioPath,
      trackId,
      outputPath: outputPath ?? defaultAudioFixturePath(trackId),
      json,
    };
  }

  let appPath = SPOTIFY_APP;
  let trackId = DEFAULT_COMPAT_TRACK_ID;
  let fixturePath: string | undefined;
  let record = false;
  let keep = false;
  let json = false;
  let positionalSeen = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--track") {
      const raw = args[++i];
      if (!raw) throw new Error("--track requires a Spotify track ID, URI, or URL");
      const parsed = parseTrackId(raw);
      if (!parsed) throw new Error(`Invalid Spotify track: ${raw}`);
      trackId = parsed;
    } else if (arg === "--fixture") {
      fixturePath = args[++i];
      if (!fixturePath) throw new Error("--fixture requires a path");
    } else if (arg === "--record") record = true;
    else if (arg === "--keep") keep = true;
    else if (arg === "--json") json = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown compat option: ${arg}`);
    else if (!positionalSeen) {
      appPath = arg;
      positionalSeen = true;
    } else {
      throw new Error(`Unexpected compat argument: ${arg}`);
    }
  }

  return { action, appPath, trackId, fixturePath, record, keep, json };
}

export function formatCompatibilityList(
  registry: SpotifyCompatibilityRegistry = SPOTIFY_COMPATIBILITY_REGISTRY,
  json = false,
): string {
  const supported = supportedSpotifyVersions(registry);
  const span = supportedSpotifySpan(registry);
  if (json) {
    return JSON.stringify({
      supportedVersions: supported,
      observedSupportedSpan: span,
      versions: registry.versions,
      note: "Unrecorded versions remain unsupported even inside the observed span.",
    }, null, 2);
  }

  const lines = ["Spotify compatibility registry:"];
  for (const entry of registry.versions) {
    lines.push(`  ${entry.version}  ${entry.status.toUpperCase()}  ${entry.architecture}  ${entry.validatedAt}`);
  }
  if (span) lines.push(`Observed supported span: ${span.min} – ${span.max}`);
  lines.push("Unrecorded versions remain unsupported; the span is informational only.");
  return lines.join("\n");
}

function formatProbeResult(result: CompatibilityProbeResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2);
  const lines = [`Spotify ${result.version}: ${result.status.toUpperCase()}`];
  for (const [name, ok] of Object.entries(result.checks)) {
    lines.push(`  ${ok ? "✓" : "✗"} ${name}`);
  }
  if (result.failureReason) lines.push(`Failure: ${result.failureReason}`);
  lines.push(`Run directory: ${result.runDir}`);
  return lines.join("\n");
}

export async function compatCommand(args: string[]): Promise<void> {
  const parsed = parseCompatArgs(args);
  if (parsed.action === "list") {
    process.stdout.write(`${formatCompatibilityList(SPOTIFY_COMPATIBILITY_REGISTRY, parsed.json)}\n`);
    return;
  }
  if (parsed.action === "fixture") {
    const fixture = createAudioFixture(parsed.audioPath, parsed.trackId);
    writeAudioFixture(parsed.outputPath, fixture);
    if (parsed.json) process.stdout.write(`${JSON.stringify({ path: parsed.outputPath, fixture }, null, 2)}\n`);
    else process.stdout.write(`Wrote whole-track audio fixture: ${parsed.outputPath}\n`);
    return;
  }

  const result = await probeSpotifyCompatibility(parsed);
  process.stdout.write(`${formatProbeResult(result, parsed.json)}\n`);
  if (result.status !== "supported") process.exitCode = 1;
}
