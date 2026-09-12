import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, extname } from "path";
import { log } from "./log";
import { validateAudioFile, validateWavFile } from "./media";

export type OutputFormat = "wav" | "mp3" | "flac" | "ogg" | "raw";

const FORMAT_ARGS: Record<Exclude<OutputFormat, "raw">, string[]> = {
  wav: ["-f", "wav"],
  mp3: ["-b:a", "320k", "-f", "mp3"],
  flac: ["-compression_level", "5", "-f", "flac"],
  ogg: ["-c:a", "vorbis", "-strict", "-2", "-f", "ogg"],
};

export async function readBoundedStreamText(
  stream: ReadableStream<Uint8Array>,
  maxBytes = 64 * 1024,
): Promise<string> {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative integer");
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const remaining = Math.max(0, maxBytes - retained);
      if (remaining > 0) {
        const kept = value.subarray(0, Math.min(remaining, value.byteLength));
        chunks.push(kept.slice());
        retained += kept.byteLength;
      }
      if (value.byteLength > remaining) truncated = true;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(retained);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes).trim();
  return truncated ? `${text}${text ? "\n" : ""}[stderr truncated]` : text;
}

function extension(path: string): string {
  return extname(path).toLowerCase().replace(".", "");
}

function canExposeRawPcm(inputPath: string): boolean {
  if (extension(inputPath) !== "wav") return false;
  const validation = validateWavFile(inputPath);
  return Boolean(
    validation.riffHeader &&
    validation.waveHeader &&
    validation.fmtChunk &&
    validation.dataChunk &&
    (validation.actualDataBytes || 0) > 0,
  );
}

export function transcode(inputPath: string, outputPath: string, format: OutputFormat): boolean {
  mkdirSync(dirname(outputPath), { recursive: true });
  const inputExt = extension(inputPath);

  if (format === "raw") {
    if (!canExposeRawPcm(inputPath)) return false;
    const data = readFileSync(inputPath);
    writeFileSync(outputPath, data.subarray(44));
    return existsSync(outputPath) && statSync(outputPath).size > 0;
  }

  if (inputExt === format) {
    copyFileSync(inputPath, outputPath);
  } else {
    const args = [
      "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
      "-threads", "0", "-i", inputPath,
      ...FORMAT_ARGS[format],
      outputPath,
    ];
    const result = spawnSync(args[0]!, args.slice(1), {
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (result.status !== 0) return false;
  }

  return existsSync(outputPath) && validateAudioFile(outputPath).ok;
}

export async function streamToWriter(
  inputPath: string,
  writer: WritableStream<Uint8Array>,
  format: OutputFormat,
): Promise<void> {
  const inputExt = extension(inputPath);
  if (format === "raw") {
    if (!canExposeRawPcm(inputPath)) {
      throw new Error(`Raw PCM output requires a validated WAV capture, got .${inputExt || "unknown"}`);
    }
    const file = Bun.file(inputPath);
    const data = new Uint8Array(await file.arrayBuffer());
    const w = writer.getWriter();
    await w.write(data.subarray(44));
    await w.close();
    return;
  }

  if (inputExt === format) {
    await Bun.file(inputPath).stream().pipeTo(writer);
    return;
  }

  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-i", inputPath,
    ...FORMAT_ARGS[format],
    "pipe:1",
  ], { stdout: "pipe", stderr: "pipe" });

  const w = writer.getWriter();
  const stderrText = readBoundedStreamText(proc.stderr as ReadableStream<Uint8Array>);
  try {
    for await (const chunk of proc.stdout) await w.write(chunk);
    await w.close();
  } catch (error) {
    proc.kill();
    await w.abort(error).catch(() => undefined);
    await proc.exited.catch(() => undefined);
    throw error;
  }

  const exitCode = await proc.exited;
  const stderr = await stderrText;
  if (exitCode !== 0) {
    throw new Error(`ffmpeg exited with code ${exitCode}: ${stderr}`);
  }
}

export async function tagMp3(
  mp3Path: string,
  meta: { title?: string; artist?: string; coverUrl?: string },
): Promise<void> {
  try {
    const NodeID3 = (await import("node-id3")).default;
    const tags: any = {};
    if (meta.title) tags.title = meta.title;
    if (meta.artist) tags.artist = meta.artist;
    if (meta.coverUrl) {
      try {
        const imgRes = await fetch(meta.coverUrl);
        if (imgRes.ok) {
          tags.image = {
            mime: imgRes.headers.get("content-type") || "image/jpeg",
            type: { id: 3, name: "front cover" },
            description: "Cover",
            imageBuffer: Buffer.from(await imgRes.arrayBuffer()),
          };
        }
      } catch {}
    }
    NodeID3.write(tags, mp3Path);
  } catch {
    log.warn("Failed to write ID3 tags");
  }
}
