import { existsSync, unlinkSync, statSync, mkdirSync } from "fs";
import { extname, join } from "path";
import { homedir } from "os";
import { log } from "../core/log";
import { resolveInput, type TrackMetadata } from "../core/metadata";
import { captureTrack } from "../core/capture";
import { streamToWriter, transcode, tagMp3, type OutputFormat } from "../core/transcode";
import { SpotifyInstance } from "../core/instance";
import { ping } from "../core/ipc";
import { IPC_SOCKET, SAVE_PATH, ensureDirs } from "../core/paths";

export interface StreamOptions {
  output?: string;
  format?: OutputFormat;
  keepWav?: boolean;
  useDaemon?: boolean;
}

function expandHome(pathStr: string): string {
  if (pathStr.startsWith("~/") || pathStr === "~") {
    return join(homedir(), pathStr.slice(pathStr === "~" ? 1 : 2));
  }
  return pathStr;
}

function isDirectoryPath(pathStr: string): boolean {
  if (pathStr.endsWith("/") || pathStr.endsWith("\\")) return true;
  try {
    return statSync(pathStr).isDirectory();
  } catch {
    const ext = extname(pathStr).toLowerCase();
    return !([".wav", ".mp3", ".flac", ".ogg", ".raw"].includes(ext));
  }
}

function formatTrackFileName(
  trackId: string,
  meta?: TrackMetadata,
  format = "mp3",
  index?: number,
  total?: number,
): string {
  const sanitize = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "-").trim();
  const prefix = total && total > 1 && index !== undefined ? `${String(index + 1).padStart(2, "0")} - ` : "";
  if (meta?.artist && meta?.title) {
    return `${prefix}${sanitize(meta.artist)} - ${sanitize(meta.title)}.${format}`;
  }
  if (meta?.title) {
    return `${prefix}${sanitize(meta.title)}.${format}`;
  }
  return `${prefix}${trackId}.${format}`;
}

export function parseStreamArgs(args: string[]): { inputs: string[]; opts: StreamOptions } {
  const inputs: string[] = [];
  const opts: StreamOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-o" || arg === "--output") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires an output path`);
      opts.output = expandHome(value);
      i++;
    } else if (arg === "-f" || arg === "--format") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires an output format`);
      if (!["wav", "mp3", "flac", "ogg", "raw"].includes(value)) {
        throw new Error(`Unsupported output format: ${value}`);
      }
      opts.format = value as OutputFormat;
      i++;
    } else if (arg === "--keep-wav") {
      opts.keepWav = true;
    } else if (arg === "--no-daemon") {
      opts.useDaemon = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown stream option: ${arg}`);
    } else {
      inputs.push(arg);
    }
  }

  // Infer format from output file extension if it's a file path
  if (opts.output && !opts.format && !isDirectoryPath(opts.output)) {
    const ext = extname(opts.output).slice(1).toLowerCase();
    if (["wav", "mp3", "flac", "ogg", "raw"].includes(ext)) {
      opts.format = ext as OutputFormat;
    }
  }

  // Default format
  if (!opts.format) opts.format = "mp3";

  // Default: use daemon if available
  if (opts.useDaemon === undefined) opts.useDaemon = true;

  return { inputs, opts };
}

function printHelp(): void {
  console.error(`
Usage: soggfy stream [options] <track-url|track-id|album-url|playlist-url>

Capture Spotify audio and stream to stdout or save to a file/directory.

Options:
  -o, --output <path>   Write to a file or directory (e.g. ~/Music/ or song.mp3)
  -f, --format <fmt>    Output format: mp3 (default), wav, flac, ogg, raw
  --keep-wav            Keep intermediate WAV file
  --no-daemon           Don't use the daemon; start a temporary instance
  -h, --help            Show this help

Examples:
  # Single track to stdout
  soggfy stream 4PTG3Z6ehGkBFwjybzWkR8 > song.mp3

  # Single track to file
  soggfy stream -o song.flac https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8

  # Entire playlist to a directory
  soggfy stream -o ~/Music/ https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M

  # Album in FLAC format to a folder
  soggfy stream -o ./album/ -f flac https://open.spotify.com/album/4eLPsYPBmXABThSJ821sqY
`);
}

export async function streamCommand(args: string[]): Promise<void> {
  const { inputs, opts } = parseStreamArgs(args);

  if (inputs.length === 0) {
    log.error("No track or playlist specified. Use 'soggfy stream --help' for usage.");
    process.exit(1);
  }

  ensureDirs();

  // Resolve all track IDs from inputs (tracks, albums, playlists)
  const allTrackIds: string[] = [];
  for (const input of inputs) {
    log.info(`Resolving tracks from input...`);
    const ids = await resolveInput(input);
    if (ids.length === 0) {
      log.error(`Could not resolve any tracks from: ${input}`);
      process.exit(1);
    }
    allTrackIds.push(...ids);
  }

  log.ok(`Resolved ${allTrackIds.length} track(s)`);

  // If output path is a directory, ensure it exists
  const isDirOutput = opts.output ? isDirectoryPath(opts.output) : false;
  if (opts.output && isDirOutput) {
    mkdirSync(opts.output, { recursive: true });
  }

  // Determine if we should use the daemon or start a temporary instance
  let socketPath = IPC_SOCKET;
  let savePath = SAVE_PATH;
  let tempInstance: SpotifyInstance | null = null;

  if (opts.useDaemon) {
    const daemonAlive = await ping(IPC_SOCKET);
    if (!daemonAlive) {
      log.info("Daemon not running. Starting temporary Spotify instance...");
      opts.useDaemon = false;
    }
  }

  if (!opts.useDaemon) {
    const tmpSocket = `/tmp/soggfy_stream_${process.pid}.sock`;
    const tmpSave = `/tmp/Soggfy_stream_${process.pid}`;
    tempInstance = new SpotifyInstance(tmpSocket, tmpSave);
    try {
      await tempInstance.start();
    } catch (e: any) {
      log.error(`Failed to start Spotify: ${e.message}`);
      log.info("Run 'soggfy install' first, then 'soggfy auth login'.");
      process.exit(1);
    }
    socketPath = tmpSocket;
    savePath = tmpSave;
  }

  try {
    for (let i = 0; i < allTrackIds.length; i++) {
      const trackId = allTrackIds[i];

      if (allTrackIds.length > 1) {
        log.header(`[${i + 1}/${allTrackIds.length}] Processing ${trackId}`);
      }

      const result = await captureTrack(socketPath, savePath, trackId);
      try {
        if (opts.output) {
          let outputPath: string;
          if (isDirOutput) {
            const fileName = formatTrackFileName(
              trackId, result.metadata, opts.format!, i, allTrackIds.length,
            );
            outputPath = join(opts.output, fileName);
          } else {
            outputPath = allTrackIds.length > 1
              ? opts.output.replace(/(\.\w+)$/, `_${i + 1}$1`)
              : opts.output;
          }

          log.info(`Transcoding to ${opts.format}...`);
          if (!transcode(result.wavPath, outputPath, opts.format!)) {
            throw new Error(`Transcoding failed for ${trackId}`);
          }
          if (opts.format === "mp3" && result.metadata) {
            await tagMp3(outputPath, result.metadata);
          }
          log.ok(`Saved: ${outputPath}`);
        } else {
          const stdout = new WritableStream<Uint8Array>({
            write(chunk) { process.stdout.write(chunk); },
            close() {},
          });
          await streamToWriter(result.wavPath, stdout, opts.format!);
        }
      } finally {
        if (!opts.keepWav && existsSync(result.wavPath)) {
          try { unlinkSync(result.wavPath); } catch {}
        }
      }
    }
  } finally {
    if (tempInstance) {
      await tempInstance.stop();
    }
  }
}
