import { existsSync, openSync, closeSync, readSync, statSync, copyFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { basename, join } from "path";
import type { OutputValidation } from "./jobs";

export function sanitizeFileName(name: string): string {
  return name.replace(/[\/\?<>\\:\*\|"]/g, "").replace(/\s+/g, " ").trim() || "track";
}

function readAscii(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString("ascii");
}

function readUInt32LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

export function expectedFloatPcmBytes(durationMs: number, sampleRate = 44100, channels = 2): number {
  return Math.floor((sampleRate * channels * 4 * durationMs) / 1000);
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
    validation.headerDataBytes = validation.dataChunk ? readUInt32LE(header, 40) : undefined;
    validation.actualDataBytes = Math.max(0, size - 44);
    validation.durationMs = Math.floor((validation.actualDataBytes / (44100 * 2 * 4)) * 1000);

    if (!validation.riffHeader) validation.warnings.push("missing_riff_header");
    if (!validation.waveHeader) validation.warnings.push("missing_wave_header");
    if (!validation.fmtChunk) validation.warnings.push("missing_fmt_chunk");
    if (!validation.dataChunk) validation.warnings.push("missing_data_chunk");
    if ((validation.actualDataBytes || 0) <= 0) validation.warnings.push("no_pcm_data");
    if (validation.headerDataBytes !== undefined && validation.actualDataBytes !== validation.headerDataBytes) {
      validation.warnings.push(`header_data_size_mismatch:${validation.headerDataBytes}:${validation.actualDataBytes}`);
    }
    if (expectedBytes && validation.actualDataBytes !== undefined) {
      const delta = Math.abs(validation.actualDataBytes - expectedBytes);
      const tolerance = Math.max(44100 * 2 * 4 * 3, Math.floor(expectedBytes * 0.05));
      if (delta > tolerance) validation.warnings.push(`unexpected_pcm_size:${validation.actualDataBytes}:${expectedBytes}`);
    }

    const sampleBytes = Math.min(validation.actualDataBytes || 0, 44100 * 2 * 4 * 10);
    if (sampleBytes >= 4) {
      const sample = Buffer.alloc(sampleBytes);
      readSync(fd, sample, 0, sampleBytes, 44);
      let squares = 0;
      let peak = 0;
      let silent = 0;
      let count = 0;
      for (let offset = 0; offset + 4 <= sample.length; offset += 4) {
        const value = sample.readFloatLE(offset);
        if (!Number.isFinite(value)) continue;
        const abs = Math.abs(value);
        squares += value * value;
        peak = Math.max(peak, abs);
        if (abs < 0.00001) silent += 1;
        count += 1;
      }
      if (count > 0) {
        validation.rms = Math.sqrt(squares / count);
        validation.peak = peak;
        validation.silenceRatio = silent / count;
        if (validation.peak < 0.0001) validation.warnings.push("near_silent_peak");
        if ((validation.silenceRatio || 0) > 0.98) validation.warnings.push("mostly_silent_sample_window");
      }
    }
  } finally {
    closeSync(fd);
  }

  return validation;
}

export function ffprobeOk(path: string): boolean {
  if (!existsSync(path)) return false;
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return probe.status === 0;
}

export function transcodeWavToMp3(wavPath: string, mp3Path: string): { ok: boolean; stderr: string } {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", wavPath, "-b:a", "320k", mp3Path], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  return { ok: result.status === 0 && existsSync(mp3Path) && statSync(mp3Path).size > 0, stderr: result.stderr || "" };
}

export function writeSidecar(outputPath: string, payload: Record<string, unknown>): string {
  const sidecarPath = `${outputPath}.json`;
  writeFileSync(sidecarPath, `${JSON.stringify(payload, null, 2)}\n`);
  return sidecarPath;
}

export function copyWavFallback(wavPath: string, outputDir: string, trackId: string): string {
  const finalPath = join(outputDir, `${trackId}.wav`);
  copyFileSync(wavPath, finalPath);
  return finalPath;
}

export function displayFileName(trackId: string, metadata?: { title?: string; artist?: string }, extension?: string): string {
  const stem = metadata?.title && metadata?.artist ? `${metadata.artist} - ${metadata.title}` : metadata?.title || trackId;
  return `${sanitizeFileName(stem)}.${extension || basename(stem).split(".").pop() || "bin"}`;
}
