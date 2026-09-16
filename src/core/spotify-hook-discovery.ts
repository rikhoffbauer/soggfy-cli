import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { readSpotifyBundleVersion } from "./spotify-runtime";

export type SpotifyHookFamilyName = "OggV1";

export interface SpotifyHookTargetsCandidate {
  family: SpotifyHookFamilyName;
  decodeAudioDataOffset: number;
  oggStreamPageinOffset: number;
}

export interface HookCandidate {
  offset: number;
  score: number;
}

export interface HookMatchSet {
  candidates: HookCandidate[];
  selected?: HookCandidate;
}

export interface OggV1TextDiscovery {
  family: "OggV1";
  status: "matched" | "not-found" | "ambiguous";
  decodeAudioData: HookMatchSet;
  oggStreamPagein: HookMatchSet;
  targets?: SpotifyHookTargetsCandidate;
  reason?: string;
}
export interface OtoolTextLayout {
  textSegmentVmAddr: bigint;
  textSectionVmAddr: bigint;
  textSectionFileOffset: number;
  textSectionSize: number;
  textSectionImageOffset: number;
}

export interface SpotifyHookDiscoveryResult extends OggV1TextDiscovery {
  version: string;
  architecture: "arm64";
  binaryPath: string;
  textLayout: OtoolTextLayout;
}

const DECODE_REFERENCE = Uint8Array.from(Buffer.from(
  "ffc301d1fc6f01a9fa6702a9f85f03a9"
  + "f65704a9f44f05a9fd7b06a9fd830191"
  + "f30304aaf40302aaf60301aa810040f9"
  + "3f0000f1e30300f9641840faa008407a"
  + "a0090054f70300aa150080d21a008052"
  + "1860009108a05d399b0c80521c0c8052"
  + "08060036e1230091e00318aa5a000094"
  + "600500346009f837e82e44b91f050071",
  "hex",
));

const OGG_REFERENCE = Uint8Array.from(Buffer.from(
  "080840b98802f837f44fbea9fd7b01a9"
  + "fd430091f40301aaf30300aae00313aa"
  + "e10314aa6affff971f0000f18c010054"
  + "c00000b4681640b928ffff3528008052",
  "hex",
));
const PROLOGUE_BYTES = 16;
const MATCH_THRESHOLD = 0.9;
const MATCH_MARGIN = 0.1;
const MAX_REPORTED_CANDIDATES = 8;

export function normalizeArm64Word(word: number): number {
  word >>>= 0;
  if (((word & 0x7c000000) >>> 0) === 0x14000000) {
    return (word & 0xfc000000) >>> 0; // B / BL: ignore imm26.
  }
  if (((word & 0xff000010) >>> 0) === 0x54000000) {
    return (word & 0xff00001f) >>> 0; // B.cond: ignore imm19.
  }
  if (((word & 0x7e000000) >>> 0) === 0x34000000) {
    return (word & 0xff00001f) >>> 0; // CBZ / CBNZ: ignore imm19.
  }
  if (((word & 0x7e000000) >>> 0) === 0x36000000) {
    return (word & 0xfff8001f) >>> 0; // TBZ / TBNZ: ignore imm14.
  }
  if (((word & 0x1f000000) >>> 0) === 0x10000000) {
    return (word & 0x9f00001f) >>> 0; // ADR / ADRP: ignore PC-relative immediate.
  }
  if (((word & 0x3b000000) >>> 0) === 0x18000000) {
    return (word & 0xff00001f) >>> 0; // Literal loads: ignore imm19.
  }
  return word;
}
function normalizedWindowScore(reference: Uint8Array, candidate: Uint8Array): number {
  const words = Math.floor(Math.min(reference.length, candidate.length) / 4);
  if (words === 0) return 0;
  const ref = Buffer.from(reference.buffer, reference.byteOffset, reference.byteLength);
  const actual = Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength);
  let matched = 0;
  for (let i = 0; i < words; i++) {
    const offset = i * 4;
    if (normalizeArm64Word(ref.readUInt32LE(offset)) === normalizeArm64Word(actual.readUInt32LE(offset))) {
      matched++;
    }
  }
  return matched / words;
}

function scanReference(text: Uint8Array, reference: Uint8Array, textImageOffset: number): HookCandidate[] {
  const haystack = Buffer.from(text.buffer, text.byteOffset, text.byteLength);
  const prologue = Buffer.from(reference.slice(0, PROLOGUE_BYTES));
  const candidates: HookCandidate[] = [];
  let cursor = 0;
  while (cursor <= haystack.length - prologue.length) {
    const found = haystack.indexOf(prologue, cursor);
    if (found < 0) break;
    if (found + reference.length <= haystack.length) {
      const window = text.subarray(found, found + reference.length);
      candidates.push({
        offset: textImageOffset + found,
        score: normalizedWindowScore(reference, window),
      });
    }
    cursor = found + 1;
  }
  return candidates.sort((a, b) => b.score - a.score || a.offset - b.offset);
}

function selectCandidate(candidates: HookCandidate[]): "matched" | "not-found" | "ambiguous" {
  const top = candidates[0];
  if (!top || top.score < MATCH_THRESHOLD) return "not-found";
  const second = candidates[1];
  if (second && second.score >= MATCH_THRESHOLD && top.score - second.score < MATCH_MARGIN) {
    return "ambiguous";
  }
  return "matched";
}
export function discoverOggV1InText(text: Uint8Array, textImageOffset: number): OggV1TextDiscovery {
  const decodeCandidates = scanReference(text, DECODE_REFERENCE, textImageOffset);
  const oggCandidates = scanReference(text, OGG_REFERENCE, textImageOffset);
  const decodeStatus = selectCandidate(decodeCandidates);
  const oggStatus = selectCandidate(oggCandidates);
  const decodeSelected = decodeStatus === "matched" ? decodeCandidates[0] : undefined;
  const oggSelected = oggStatus === "matched" ? oggCandidates[0] : undefined;

  const base = {
    family: "OggV1" as const,
    decodeAudioData: {
      candidates: decodeCandidates.slice(0, MAX_REPORTED_CANDIDATES),
      ...(decodeSelected ? { selected: decodeSelected } : {}),
    },
    oggStreamPagein: {
      candidates: oggCandidates.slice(0, MAX_REPORTED_CANDIDATES),
      ...(oggSelected ? { selected: oggSelected } : {}),
    },
  };

  if (decodeStatus === "ambiguous" || oggStatus === "ambiguous") {
    return { ...base, status: "ambiguous", reason: "Multiple high-confidence OggV1 hook candidates were found" };
  }
  if (!decodeSelected || !oggSelected) {
    return { ...base, status: "not-found", reason: "Could not find a unique high-confidence OggV1 hook pair" };
  }
  return {
    ...base,
    status: "matched",
    targets: {
      family: "OggV1",
      decodeAudioDataOffset: decodeSelected.offset,
      oggStreamPageinOffset: oggSelected.offset,
    },
  };
}
function parseInteger(raw: string): bigint {
  return BigInt(raw.trim());
}

export function parseOtoolTextLayout(output: string): OtoolTextLayout {
  const segment = output.match(
    /cmd LC_SEGMENT_64[\s\S]*?segname __TEXT\s+vmaddr\s+(0x[0-9a-fA-F]+)[\s\S]*?fileoff\s+([0-9]+)/,
  );
  const section = output.match(
    /Section\s+sectname __text\s+segname __TEXT\s+addr\s+(0x[0-9a-fA-F]+)\s+size\s+(0x[0-9a-fA-F]+|[0-9]+)\s+offset\s+([0-9]+)/,
  );
  if (!segment || !section) {
    throw new Error("Could not locate the arm64 __TEXT,__text layout in Spotify");
  }
  const textSegmentVmAddr = parseInteger(segment[1]!);
  const textSectionVmAddr = parseInteger(section[1]!);
  const imageOffset = textSectionVmAddr - textSegmentVmAddr;
  if (imageOffset < 0n || imageOffset > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid __text image offset: ${imageOffset}`);
  }
  return {
    textSegmentVmAddr,
    textSectionVmAddr,
    textSectionFileOffset: Number(section[3]),
    textSectionSize: Number(parseInteger(section[2]!)),
    textSectionImageOffset: Number(imageOffset),
  };
}

function runOtool(binaryPath: string): string {
  const result = Bun.spawnSync(["otool", "-arch", "arm64", "-l", binaryPath], {
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Could not inspect Spotify Mach-O: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}
export function discoverSpotifyHookTargets(appPath: string): SpotifyHookDiscoveryResult {
  const binaryPath = join(appPath, "Contents/MacOS/Spotify");
  if (!existsSync(binaryPath)) throw new Error(`Spotify binary not found: ${binaryPath}`);
  const version = readSpotifyBundleVersion(appPath);
  if (!version) throw new Error(`Could not read Spotify version from ${appPath}`);

  const textLayout = parseOtoolTextLayout(runOtool(binaryPath));
  const binary = readFileSync(binaryPath);
  const start = textLayout.textSectionFileOffset;
  const end = start + textLayout.textSectionSize;
  if (start < 0 || end > binary.length || end <= start) {
    throw new Error(`Invalid __text file range: ${start}..${end} for ${binary.length}-byte binary`);
  }
  const discovery = discoverOggV1InText(binary.subarray(start, end), textLayout.textSectionImageOffset);
  return {
    ...discovery,
    version,
    architecture: "arm64",
    binaryPath,
    textLayout,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function updateSpotifyHookTargetsHeader(
  source: string,
  version: string,
  targets: SpotifyHookTargetsCandidate,
): { source: string; changed: boolean } {
  if (!/^\d+(?:\.\d+)+$/.test(version)) throw new Error(`Invalid Spotify version: ${version}`);
  if (targets.family !== "OggV1") throw new Error(`Unsupported hook family: ${targets.family}`);
  const existingPattern = new RegExp(
    `\\{"${escapeRegExp(version)}",\\s*(0x[0-9a-fA-F]+),\\s*(0x[0-9a-fA-F]+),\\s*SpotifyHookFamily::([A-Za-z0-9_]+)\\}`,
  );
  const existing = source.match(existingPattern);
  if (existing) {
    const same = Number.parseInt(existing[1]!, 16) === targets.decodeAudioDataOffset
      && Number.parseInt(existing[2]!, 16) === targets.oggStreamPageinOffset
      && existing[3] === targets.family;
    if (same) return { source, changed: false };
    throw new Error(`Refusing to overwrite existing native hook targets for Spotify ${version}`);
  }
  const tableStart = source.indexOf("static constexpr SpotifyHookTargets targets[] = {");
  if (tableStart < 0) throw new Error("Could not locate Spotify native hook target table");
  const tableTail = source.slice(tableStart);
  const close = tableTail.match(/\n\s*};/);
  if (!close || close.index === undefined) throw new Error("Could not locate Spotify native hook target table end");
  const insertAt = tableStart + close.index;
  const row = `\n      {"${version}", 0x${targets.decodeAudioDataOffset.toString(16)}, 0x${targets.oggStreamPageinOffset.toString(16)}, SpotifyHookFamily::${targets.family}},`;
  return { source: source.slice(0, insertAt) + row + source.slice(insertAt), changed: true };
}
export function compatibilityHookTargetEnvironment(
  version: string,
  targets: SpotifyHookTargetsCandidate,
): Record<string, string> {
  if (!/^\d+(?:\.\d+)+$/.test(version)) throw new Error(`Invalid Spotify version: ${version}`);
  return {
    SOGGFY_COMPAT_ALLOW_DISCOVERED_TARGETS: "1",
    SOGGFY_COMPAT_EXPECTED_VERSION: version,
    SOGGFY_COMPAT_HOOK_FAMILY: targets.family,
    SOGGFY_COMPAT_DECODE_OFFSET: `0x${targets.decodeAudioDataOffset.toString(16)}`,
    SOGGFY_COMPAT_OGG_PAGEIN_OFFSET: `0x${targets.oggStreamPageinOffset.toString(16)}`,
  };
}
