import { spawnSync } from "child_process";
import { existsSync, statSync, readFileSync, copyFileSync, mkdirSync } from "fs";
import { dirname, extname } from "path";
import { log } from "./log";

export type OutputFormat = "wav" | "mp3" | "flac" | "ogg" | "raw";

/**
 * Transcode a WAV file to the requested format, writing to outputPath.
 * Returns true on success.
 */
export function transcode(inputPath: string, outputPath: string, format: OutputFormat): boolean {
  mkdirSync(dirname(outputPath), { recursive: true });

  const inputExt = extname(inputPath).toLowerCase().replace(".", "");
  if (inputExt === format) {
    copyFileSync(inputPath, outputPath);
    return existsSync(outputPath) && statSync(outputPath).size > 0;
  }

  if (format === "raw") {
    // Strip WAV header (44 bytes), output raw PCM
    const data = readFileSync(inputPath);
    Bun.write(outputPath, data.subarray(44));
    return existsSync(outputPath);
  }

  const formatArgs: Record<string, string[]> = {
    mp3: ["-b:a", "320k"],
    flac: ["-compression_level", "5"],
    ogg: ["-c:a", "vorbis", "-strict", "-2"],
  };

  const args = [
    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
    "-threads", "0",
    "-i", inputPath,
    ...(formatArgs[format] || []),
    outputPath,
  ];

  const result = spawnSync(args[0], args.slice(1), {
    stdio: ["ignore", "ignore", "pipe"],
  });

  return result.status === 0 && existsSync(outputPath) && statSync(outputPath).size > 0;
}

/**
 * Stream a WAV (or transcoded audio) to a writable stream (e.g. stdout).
 * For non-WAV formats, pipes through ffmpeg.
 */
export async function streamToWriter(
  wavPath: string,
  writer: WritableStream<Uint8Array>,
  format: OutputFormat,
): Promise<void> {
  if (format === "wav") {
    const file = Bun.file(wavPath);
    const stream = file.stream();
    await stream.pipeTo(writer);
    return;
  }

  if (format === "raw") {
    // Stream raw PCM (skip 44-byte WAV header)
    const file = Bun.file(wavPath);
    const data = new Uint8Array(await file.arrayBuffer());
    const w = writer.getWriter();
    await w.write(data.subarray(44));
    await w.close();
    return;
  }

  // Pipe through ffmpeg for format conversion
  const formatArgs: Record<string, string[]> = {
    mp3: ["-b:a", "320k", "-f", "mp3"],
    flac: ["-compression_level", "5", "-f", "flac"],
    ogg: ["-c:a", "vorbis", "-strict", "-2", "-f", "ogg"],
  };

  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-i", wavPath,
    ...(formatArgs[format] || []),
    "pipe:1",
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const w = writer.getWriter();
  try {
    for await (const chunk of proc.stdout) {
      await w.write(chunk);
    }
  } finally {
    await w.close();
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg exited with code ${exitCode}: ${stderr}`);
  }
}

/**
 * Tag an MP3 file with metadata.
 */
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
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        tags.image = {
          mime: "image/jpeg",
          type: { id: 3, name: "front cover" },
          description: "Cover",
          imageBuffer: buffer,
        };
      } catch {}
    }
    NodeID3.write(tags, mp3Path);
  } catch {
    log.warn("Failed to write ID3 tags");
  }
}
