import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from "fs";
import { spawnSync } from "child_process";
import { basename, extname, join } from "path";

export interface OutputValidation {
  riffHeader?: boolean;
  waveHeader?: boolean;
  fmtChunk?: boolean;
  dataChunk?: boolean;
  headerDataBytes?: number;
  actualDataBytes?: number;
  durationMs?: number;
  rms?: number;
  peak?: number;
  silenceRatio?: number;
  ffprobeOk?: boolean;
  warnings: string[];
}

export interface AudioValidation extends OutputValidation {
  ok: boolean;
  container?: string;
  decodedSignalOk?: boolean;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[\/\?<>\\:\*\|"]/g, "").replace(/\s+/g, " ").trim() || "track";
}

export function expectedFloatPcmBytes(
  durationMs: number,
  sampleRate = 44_100,
  channels = 2,
): number {
  return Math.floor((sampleRate * channels * 4 * durationMs) / 1000);
}

export function expectedOggBytes(durationMs: number, bitrateKbps = 320): number {
  return Math.floor((bitrateKbps * 1000 / 8) * (durationMs / 1000));
}

export function findCapturedAudioPath(savePath: string, trackId: string): string | null {
  for (const extension of ["ogg", "wav"] as const) {
    const candidate = join(savePath, `${trackId}.${extension}`);
    if (existsSync(candidate) && statSync(candidate).size > 0) return candidate;
  }
  return null;
}

function readAscii(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString("ascii");
}

export function validateWavFile(path: string, expectedBytes?: number): OutputValidation {
  const validation: OutputValidation = { warnings: [] };
  if (!existsSync(path)) {
    validation.warnings.push("file_missing");
    return validation;
  }

  const size = statSync(path).size;
  if (size < 44) {
    validation.warnings.push(`too_small:${size}`);
    return validation;
  }

  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(44);
    readSync(fd, header, 0, 44, 0);
    validation.riffHeader = readAscii(header, 0, 4) === "RIFF";
    validation.waveHeader = readAscii(header, 8, 12) === "WAVE";
    validation.fmtChunk = readAscii(header, 12, 16) === "fmt ";
    validation.dataChunk = readAscii(header, 36, 40) === "data";
    validation.headerDataBytes = validation.dataChunk ? header.readUInt32LE(40) : undefined;
    validation.actualDataBytes = Math.max(0, size - 44);

    if (!validation.riffHeader) validation.warnings.push("missing_riff_header");
    if (!validation.waveHeader) validation.warnings.push("missing_wave_header");
    if (!validation.fmtChunk) validation.warnings.push("missing_fmt_chunk");
    if (!validation.dataChunk) validation.warnings.push("missing_data_chunk");
    if ((validation.actualDataBytes || 0) <= 0) validation.warnings.push("no_pcm_data");
    if (
      validation.headerDataBytes !== undefined &&
      validation.actualDataBytes !== validation.headerDataBytes
    ) {
      validation.warnings.push(
        `header_data_size_mismatch:${validation.headerDataBytes}:${validation.actualDataBytes}`,
      );
    }
    if (expectedBytes && validation.actualDataBytes !== undefined) {
      const delta = Math.abs(validation.actualDataBytes - expectedBytes);
      const tolerance = Math.max(44_100 * 2 * 4 * 3, Math.floor(expectedBytes * 0.05));
      if (delta > tolerance) {
        validation.warnings.push(`unexpected_pcm_size:${validation.actualDataBytes}:${expectedBytes}`);
      }
    }
  } finally {
    closeSync(fd);
  }
  return validation;
}

function probeDurationMs(path: string): { ok: boolean; durationMs?: number; container?: string } {
  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,format_name",
    "-of", "json",
    path,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (probe.status !== 0) return { ok: false };
  try {
    const parsed = JSON.parse(probe.stdout || "{}");
    const seconds = Number(parsed.format?.duration);
    return {
      ok: true,
      durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined,
      container: parsed.format?.format_name,
    };
  } catch {
    return { ok: false };
  }
}

function analyzeDecodedSignal(path: string, startSeconds = 0, durationSeconds = 10): {
  ok: boolean;
  rms?: number;
  peak?: number;
  silenceRatio?: number;
} {
  const decoded = spawnSync("ffmpeg", [
    "-v", "error", ...(startSeconds > 0 ? ["-ss", String(startSeconds)] : []), "-i", path,
    "-t", String(durationSeconds), "-ac", "1", "-ar", "16000",
    "-f", "f32le", "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024 });
  if (decoded.status !== 0 || !decoded.stdout || decoded.stdout.length < 4) return { ok: false };

  const samples = Math.floor(decoded.stdout.length / 4);
  let squares = 0;
  let peak = 0;
  let silent = 0;
  let count = 0;
  for (let i = 0; i < samples; i++) {
    const value = decoded.stdout.readFloatLE(i * 4);
    if (!Number.isFinite(value)) continue;
    const abs = Math.abs(value);
    squares += value * value;
    peak = Math.max(peak, abs);
    if (abs < 0.00001) silent++;
    count++;
  }
  if (count === 0) return { ok: false };
  return {
    ok: true,
    rms: Math.sqrt(squares / count),
    peak,
    silenceRatio: silent / count,
  };
}

export function validateAudioFile(path: string, expectedDurationMs?: number): AudioValidation {
  const ext = extname(path).toLowerCase();
  const base = ext === ".wav"
    ? validateWavFile(path, expectedDurationMs ? expectedFloatPcmBytes(expectedDurationMs) : undefined)
    : { warnings: [] as string[] };
  const validation: AudioValidation = { ...base, ok: false };

  const probe = probeDurationMs(path);
  validation.ffprobeOk = probe.ok;
  validation.durationMs = probe.durationMs;
  validation.container = probe.container;
  if (!probe.ok) validation.warnings.push("ffprobe_failed");

  if (expectedDurationMs && probe.durationMs !== undefined) {
    const toleranceMs = Math.max(3000, Math.round(expectedDurationMs * 0.05));
    if (Math.abs(probe.durationMs - expectedDurationMs) > toleranceMs) {
      validation.warnings.push(`unexpected_duration:${probe.durationMs}:${expectedDurationMs}`);
    }
  }

  const durationSeconds = probe.durationMs ? probe.durationMs / 1000 : undefined;
  const offsets = durationSeconds && durationSeconds > 12
    ? [...new Set([
        0,
        Math.max(0, durationSeconds / 2 - 5),
        Math.max(0, durationSeconds - 10),
      ].map((value) => Math.round(value * 1000) / 1000))]
    : [0];
  const signals = offsets.map((offset) => analyzeDecodedSignal(path, offset));
  const usableSignals = signals.filter((signal) => signal.ok);
  validation.decodedSignalOk = usableSignals.length > 0;
  validation.rms = usableSignals.length
    ? Math.max(...usableSignals.map((signal) => signal.rms ?? 0))
    : undefined;
  validation.peak = usableSignals.length
    ? Math.max(...usableSignals.map((signal) => signal.peak ?? 0))
    : undefined;
  validation.silenceRatio = usableSignals.length
    ? Math.min(...usableSignals.map((signal) => signal.silenceRatio ?? 1))
    : undefined;
  if (usableSignals.length === 0) validation.warnings.push("decode_failed");
  if (validation.peak !== undefined && validation.peak < 0.0001) {
    validation.warnings.push("near_silent_peak");
  }
  if (validation.silenceRatio !== undefined && validation.silenceRatio > 0.98) {
    validation.warnings.push("mostly_silent_sample_window");
  }

  const fatalPrefixes = [
    "file_missing", "too_small", "missing_", "no_pcm_data",
    "header_data_size_mismatch", "unexpected_pcm_size", "ffprobe_failed",
    "unexpected_duration", "decode_failed", "near_silent_peak",
    "mostly_silent_sample_window",
  ];
  validation.ok = !validation.warnings.some((warning) =>
    fatalPrefixes.some((prefix) => warning.startsWith(prefix))
  );
  return validation;
}

export function ffprobeOk(path: string): boolean {
  return probeDurationMs(path).ok;
}

export function transcodeAudioToMp3(
  inputPath: string,
  mp3Path: string,
): { ok: boolean; stderr: string } {
  const result = spawnSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", inputPath, "-b:a", "320k", mp3Path,
  ], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  return {
    ok: result.status === 0 && existsSync(mp3Path) && statSync(mp3Path).size > 0,
    stderr: result.stderr || "",
  };
}

export const transcodeWavToMp3 = transcodeAudioToMp3;

export function writeSidecar(outputPath: string, payload: Record<string, unknown>): string {
  const sidecarPath = `${outputPath}.json`;
  writeFileSync(sidecarPath, `${JSON.stringify(payload, null, 2)}\n`);
  return sidecarPath;
}

export function copyAudioFallback(inputPath: string, outputDir: string, trackId: string): string {
  const extension = extname(inputPath).toLowerCase() || ".bin";
  const finalPath = join(outputDir, `${trackId}${extension}`);
  copyFileSync(inputPath, finalPath);
  return finalPath;
}

export function copyWavFallback(wavPath: string, outputDir: string, trackId: string): string {
  return copyAudioFallback(wavPath, outputDir, trackId);
}

export function displayFileName(
  trackId: string,
  metadata?: { title?: string; artist?: string },
  extension?: string,
): string {
  const stem = metadata?.title && metadata?.artist
    ? `${metadata.artist} - ${metadata.title}`
    : metadata?.title || trackId;
  return `${sanitizeFileName(stem)}.${extension || basename(stem).split(".").pop() || "bin"}`;
}
