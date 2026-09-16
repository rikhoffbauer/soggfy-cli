import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { randomUUID } from "crypto";

export interface AudioFixtureDigest {
  bytes: number;
  sha256: string;
}

export interface DecodedPcmFixture extends AudioFixtureDigest {
  format: "s16le";
  sampleRate: 44_100;
  channels: 2;
}

export interface AudioFixture {
  schemaVersion: 1;
  trackId: string;
  createdAt: string;
  file: AudioFixtureDigest;
  decodedPcm: DecodedPcmFixture;
}

export interface AudioFixtureVerification {
  ok: boolean;
  exactFileMatch: boolean;
  decodedPcmMatch: boolean;
  actualFile: AudioFixtureDigest;
  actualDecodedPcm: DecodedPcmFixture;
}

export const AUDIO_FIXTURE_DIR = resolve(import.meta.dir, "../../compatibility/audio-fixtures");

export function defaultAudioFixturePath(trackId: string): string {
  return join(AUDIO_FIXTURE_DIR, `${trackId}.json`);
}

function digestFile(path: string): AudioFixtureDigest {
  if (!existsSync(path)) throw new Error(`Audio fixture input not found: ${path}`);
  const data = readFileSync(path);
  return {
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

function digestDecodedPcm(path: string): DecodedPcmFixture {
  const workDir = join(tmpdir(), `soggfy-pcm-${process.pid}-${randomUUID()}`);
  const rawPath = join(workDir, "audio.s16le");
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  try {
    const result = Bun.spawnSync([
      "ffmpeg", "-nostdin", "-y", "-v", "error",
      "-i", path,
      "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "44100",
      "-f", "s16le", rawPath,
    ], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0 || !existsSync(rawPath)) {
      throw new Error(`Could not decode complete audio fixture: ${result.stderr.toString().trim()}`);
    }
    const digest = digestFile(rawPath);
    return {
      format: "s16le",
      sampleRate: 44_100,
      channels: 2,
      ...digest,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function createAudioFixture(audioPath: string, trackId: string): AudioFixture {
  if (!trackId.trim()) throw new Error("Audio fixture requires a track ID");
  return {
    schemaVersion: 1,
    trackId,
    createdAt: new Date().toISOString(),
    file: digestFile(audioPath),
    decodedPcm: digestDecodedPcm(audioPath),
  };
}

export function verifyAudioFixture(audioPath: string, fixture: AudioFixture): AudioFixtureVerification {
  const actualFile = digestFile(audioPath);
  const actualDecodedPcm = digestDecodedPcm(audioPath);
  const exactFileMatch = actualFile.bytes === fixture.file.bytes
    && actualFile.sha256 === fixture.file.sha256;
  const decodedPcmMatch = actualDecodedPcm.bytes === fixture.decodedPcm.bytes
    && actualDecodedPcm.sha256 === fixture.decodedPcm.sha256;
  return {
    ok: exactFileMatch && decodedPcmMatch,
    exactFileMatch,
    decodedPcmMatch,
    actualFile,
    actualDecodedPcm,
  };
}

export function readAudioFixture(path: string): AudioFixture {
  if (!existsSync(path)) throw new Error(`Audio fixture manifest not found: ${path}`);
  const fixture = JSON.parse(readFileSync(path, "utf8")) as AudioFixture;
  if (fixture.schemaVersion !== 1 || !fixture.trackId || !fixture.file?.sha256 || !fixture.decodedPcm?.sha256) {
    throw new Error(`Invalid audio fixture manifest: ${path}`);
  }
  return fixture;
}

export function writeAudioFixture(path: string, fixture: AudioFixture): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  if (statSync(path).size <= 0) throw new Error(`Failed to write audio fixture manifest: ${path}`);
}
