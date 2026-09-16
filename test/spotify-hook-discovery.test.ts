import { expect, test } from "bun:test";
import {
  compatibilityHookTargetEnvironment,
  discoverOggV1InText,
  normalizeArm64Word,
  parseOtoolTextLayout,
  updateSpotifyHookTargetsHeader,
} from "../src/core/spotify-hook-discovery";

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.replace(/\s+/g, ""), "hex"));
}

const decodeWindow = bytes(`
  ffc301d1fc6f01a9fa6702a9f85f03a9
  f65704a9f44f05a9fd7b06a9fd830191
  f30304aaf40302aaf60301aa810040f9
  3f0000f1e30300f9641840faa008407a
  a0090054f70300aa150080d21a008052
  1860009108a05d399b0c80521c0c8052
  08060036e1230091e00318aa5a000094
  600500346009f837e82e44b91f050071
`);

const oggWindow = bytes(`
  080840b98802f837f44fbea9fd7b01a9
  fd430091f40301aaf30300aae00313aa
  e10314aa6affff971f0000f18c010054
  c00000b4681640b928ffff3528008052
`);
test("ARM64 branch immediates normalize away while opcode/register identity remains", () => {
  expect(normalizeArm64Word(0x94000001)).toBe(normalizeArm64Word(0x97ffffff));
  expect(normalizeArm64Word(0x54000020)).toBe(normalizeArm64Word(0x54ffffe0));
  expect(normalizeArm64Word(0xaa0103e0)).not.toBe(normalizeArm64Word(0xaa0203e0));
});

test("OggV1 discovery selects the unique structural matches and returns image offsets", () => {
  const text = new Uint8Array(0x1000);
  text.set(decodeWindow, 0x180);
  text.set(oggWindow, 0x700);
  const result = discoverOggV1InText(text, 0x12000);
  expect(result.status).toBe("matched");
  expect(result.targets).toEqual({
    family: "OggV1",
    decodeAudioDataOffset: 0x12180,
    oggStreamPageinOffset: 0x12700,
  });
  expect(result.decodeAudioData.candidates[0]?.score).toBe(1);
  expect(result.oggStreamPagein.candidates[0]?.score).toBe(1);
});

test("OggV1 discovery fails closed when equally strong decode candidates exist", () => {
  const text = new Uint8Array(0x1400);
  text.set(decodeWindow, 0x100);
  text.set(decodeWindow, 0x500);
  text.set(oggWindow, 0xa00);
  const result = discoverOggV1InText(text, 0);
  expect(result.status).toBe("ambiguous");
  expect(result.targets).toBeUndefined();
});
test("otool layout parsing maps __text file bytes to image-relative offsets", () => {
  const layout = parseOtoolTextLayout(`
Load command 1
      cmd LC_SEGMENT_64
  cmdsize 632
  segname __TEXT
   vmaddr 0x0000000100000000
  fileoff 0
 filesize 123456
Section
  sectname __text
   segname __TEXT
      addr 0x0000000100004000
      size 0x0000000000010000
    offset 16384
`);
  expect(layout).toEqual({
    textSegmentVmAddr: 0x100000000n,
    textSectionVmAddr: 0x100004000n,
    textSectionFileOffset: 16384,
    textSectionSize: 0x10000,
    textSectionImageOffset: 0x4000,
  });
});

test("temporary discovered targets are encoded into an explicitly gated compatibility environment", () => {
  expect(compatibilityHookTargetEnvironment("1.3.1.123", {
    family: "OggV1", decodeAudioDataOffset: 0x13183ac, oggStreamPageinOffset: 0x134cf10,
  })).toEqual({
    SOGGFY_COMPAT_ALLOW_DISCOVERED_TARGETS: "1",
    SOGGFY_COMPAT_EXPECTED_VERSION: "1.3.1.123",
    SOGGFY_COMPAT_HOOK_FAMILY: "OggV1",
    SOGGFY_COMPAT_DECODE_OFFSET: "0x13183ac",
    SOGGFY_COMPAT_OGG_PAGEIN_OFFSET: "0x134cf10",
  });
});

test("native target source updater inserts a new exact target without overwriting existing rows", () => {
  const source = `static constexpr SpotifyHookTargets targets[] = {\n      {"1.2.99.317", 0x1293f04, 0x12c84e4, SpotifyHookFamily::OggV1},\n  };`;
  const updated = updateSpotifyHookTargetsHeader(source, "1.3.1.123", {
    family: "OggV1",
    decodeAudioDataOffset: 0x13183ac,
    oggStreamPageinOffset: 0x134cf10,
  });
  expect(updated.changed).toBe(true);
  expect(updated.source).toContain('{"1.3.1.123", 0x13183ac, 0x134cf10, SpotifyHookFamily::OggV1}');
  expect(() => updateSpotifyHookTargetsHeader(source, "1.2.99.317", {
    family: "OggV1", decodeAudioDataOffset: 1, oggStreamPageinOffset: 2,
  })).toThrow("Refusing to overwrite existing native hook targets");
});
