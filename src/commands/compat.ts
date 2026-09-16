import { SPOTIFY_APP } from "../core/paths";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  SPOTIFY_COMPATIBILITY_REGISTRY,
  supportedSpotifySpan,
  supportedSpotifyVersions,
  type SpotifyCompatibilityRegistry,
} from "../core/spotify-compatibility";
import {
  DEFAULT_COMPAT_TRACK_ID,
  probeSpotifyCompatibility,
  recordCompatibilityProbe,
  type CompatProbeOptions,
  type CompatibilityProbeResult,
} from "../core/compat-probe";
import { parseTrackId } from "../core/spotify-url";
import { createAudioFixture, defaultAudioFixturePath, writeAudioFixture } from "../core/audio-fixture";
import {
  discoverSpotifyHookTargets,
  updateSpotifyHookTargetsHeader,
  type SpotifyHookDiscoveryResult,
} from "../core/spotify-hook-discovery";

const SPOTIFY_HOOK_TARGETS_HEADER = resolve(
  import.meta.dir,
  "../../soggfy-macos/Payload/SpotifyHookTargets.h",
);

export interface CompatAnalyzeResult {
  discovery: SpotifyHookDiscoveryResult;
  temporaryProbe?: CompatibilityProbeResult;
  productionProbe?: CompatibilityProbeResult;
  recorded?: boolean;
}

export type CompatArgs =
  | ({ action: "probe" } & CompatProbeOptions)
  | { action: "analyze"; appPath: string; trackId: string; fixturePath?: string; probe: boolean; record: boolean; keep: boolean; json: boolean }
  | { action: "list"; json: boolean }
  | { action: "fixture"; audioPath: string; trackId: string; outputPath: string; json: boolean };

export function parseCompatArgs(args: string[]): CompatArgs {
  const action = args[0];
  if (action !== "probe" && action !== "analyze" && action !== "list" && action !== "fixture") {
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
  let runProbe = false;
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
    } else if (arg === "--probe" && action === "analyze") runProbe = true;
    else if (arg === "--record") record = true;
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

  if (action === "analyze") {
    if (record && !runProbe) throw new Error("compat analyze --record requires --probe");
    return { action, appPath, trackId, fixturePath, probe: runProbe, record, keep, json };
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

function stringifyCompatJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? `0x${item.toString(16)}` : item, 2);
}

export function formatAnalyzeResult(result: CompatAnalyzeResult, json: boolean): string {
  if (json) return stringifyCompatJson(result);
  const { discovery } = result;
  const lines = [`Spotify ${discovery.version}: OggV1 discovery ${discovery.status.toUpperCase()}`];
  const decode = discovery.decodeAudioData.selected ?? discovery.decodeAudioData.candidates[0];
  const ogg = discovery.oggStreamPagein.selected ?? discovery.oggStreamPagein.candidates[0];
  if (decode) lines.push(`  DecodeAudioData: 0x${decode.offset.toString(16)} score=${decode.score.toFixed(3)}`);
  if (ogg) lines.push(`  ogg_stream_pagein: 0x${ogg.offset.toString(16)} score=${ogg.score.toFixed(3)}`);
  if (discovery.reason) lines.push(`  Discovery: ${discovery.reason}`);
  if (result.temporaryProbe) lines.push(`Temporary discovered-target probe: ${result.temporaryProbe.status.toUpperCase()}`);
  if (result.productionProbe) lines.push(`Production exact-target probe: ${result.productionProbe.status.toUpperCase()}`);
  if (result.recorded) lines.push("Recorded exact native target and compatibility support.");
  return lines.join("\n");
}

async function analyzeSpotifyCompatibility(parsed: Extract<CompatArgs, { action: "analyze" }>): Promise<CompatAnalyzeResult> {
  const discovery = discoverSpotifyHookTargets(parsed.appPath);
  const result: CompatAnalyzeResult = { discovery };
  if (discovery.status !== "matched" || !discovery.targets || !parsed.probe) return result;

  result.temporaryProbe = await probeSpotifyCompatibility({
    appPath: parsed.appPath,
    trackId: parsed.trackId,
    fixturePath: parsed.fixturePath,
    record: false,
    keep: parsed.keep,
    json: parsed.json,
    compatibilityHookTargets: discovery.targets,
  });
  if (result.temporaryProbe.status !== "supported" || !parsed.record) return result;

  const originalHeader = readFileSync(SPOTIFY_HOOK_TARGETS_HEADER, "utf8");
  const updatedHeader = updateSpotifyHookTargetsHeader(originalHeader, discovery.version, discovery.targets);
  if (updatedHeader.changed) writeFileSync(SPOTIFY_HOOK_TARGETS_HEADER, updatedHeader.source);
  try {
    result.productionProbe = await probeSpotifyCompatibility({
      appPath: parsed.appPath,
      trackId: parsed.trackId,
      fixturePath: parsed.fixturePath,
      record: false,
      keep: parsed.keep,
      json: parsed.json,
    });
    if (result.productionProbe.status !== "supported") {
      if (updatedHeader.changed) writeFileSync(SPOTIFY_HOOK_TARGETS_HEADER, originalHeader);
      return result;
    }
    recordCompatibilityProbe(result.productionProbe);
    result.recorded = true;
    return result;
  } catch (error) {
    if (updatedHeader.changed) writeFileSync(SPOTIFY_HOOK_TARGETS_HEADER, originalHeader);
    throw error;
  }
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
  if (parsed.action === "analyze") {
    const result = await analyzeSpotifyCompatibility(parsed);
    process.stdout.write(`${formatAnalyzeResult(result, parsed.json)}\n`);
    const failed = result.discovery.status !== "matched"
      || (parsed.probe && result.temporaryProbe?.status !== "supported")
      || (parsed.record && result.recorded !== true);
    if (failed) process.exitCode = 1;
    return;
  }

  const result = await probeSpotifyCompatibility(parsed);
  process.stdout.write(`${formatProbeResult(result, parsed.json)}\n`);
  if (result.status !== "supported") process.exitCode = 1;
}
