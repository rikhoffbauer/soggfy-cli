import { chmodSync, copyFileSync, existsSync, unlinkSync, statSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "fs";
import { extname, join } from "path";
import { homedir, tmpdir } from "os";
import { log } from "../core/log";
import { resolveInput, type TrackMetadata } from "../core/metadata";
import { captureTrack, type CaptureResult } from "../core/capture";
import { streamToWriter, transcode, tagMp3, type OutputFormat } from "../core/transcode";
import { SpotifyInstance } from "../core/instance";
import { ping } from "../core/ipc";
import { captureTrackViaDaemon, daemonApiHealthy } from "../core/daemon-capture";
import { IPC_SOCKET, RETAINED_CAPTURE_DIR, SAVE_PATH, ensureDirs } from "../core/paths";

export interface DownloadOptions {
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

export function parseDownloadArgs(args: string[]): { inputs: string[]; opts: DownloadOptions } {
  const inputs: string[] = [];
  const opts: DownloadOptions = {};

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
      throw new Error(`Unknown download option: ${arg}`);
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
Usage: soggfy download [options] <track-url|track-id|album-url|playlist-url>

Capture Spotify audio and stream to stdout or save to a file/directory.

Options:
  -o, --output <path>   Write to a file or directory (e.g. ~/Music/ or song.mp3)
  -f, --format <fmt>    Output format: mp3 (default), wav, flac, ogg, raw
  --keep-wav            Keep intermediate WAV file
  --no-daemon           Don't use the daemon; start a temporary instance
  -h, --help            Show this help

Examples:
  # Single track to stdout
  soggfy download 4PTG3Z6ehGkBFwjybzWkR8 > song.mp3

  # Single track to file
  soggfy download -o song.flac https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8

  # Entire playlist to a directory
  soggfy download -o ~/Music/ https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M

  # Album in FLAC format to a folder
  soggfy download -o ./album/ -f flac https://open.spotify.com/album/4eLPsYPBmXABThSJ821sqY
`);
}


export function shouldRemoveCaptureAfterOutput(options: {
  keepCapture: boolean;
  outputSucceeded: boolean;
}): boolean {
  return options.outputSucceeded && !options.keepCapture;
}

export function retainStandaloneCapture(
  capturePath: string,
  trackId: string,
  retainedDir = RETAINED_CAPTURE_DIR,
): string {
  mkdirSync(retainedDir, { recursive: true, mode: 0o700 });
  const extension = extname(capturePath) || ".audio";
  const destination = join(retainedDir, `${trackId}-${Date.now()}${extension}`);
  try {
    renameSync(capturePath, destination);
  } catch {
    copyFileSync(capturePath, destination);
    unlinkSync(capturePath);
  }
  chmodSync(destination, 0o600);
  log.info(`Preserved capture: ${destination}`);
  return destination;
}

function retainStandaloneCaptureCandidate(
  savePath: string,
  trackId: string,
  retainCapture: (capturePath: string, trackId: string) => string = retainStandaloneCapture,
): string | undefined {
  for (const extension of [".ogg", ".wav"]) {
    const candidate = join(savePath, `${trackId}${extension}`);
    if (existsSync(candidate)) return retainCapture(candidate, trackId);
  }
  return undefined;
}

interface DownloadSpotifyInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface DownloadCommandDependencies {
  ensureDirs: typeof ensureDirs;
  resolveInput: typeof resolveInput;
  daemonApiHealthy: typeof daemonApiHealthy;
  ping: typeof ping;
  makeTempRoot: () => string;
  createSpotifyInstance: (socketPath: string, savePath: string) => DownloadSpotifyInstance;
  captureTrack: typeof captureTrack;
  captureTrackViaDaemon: typeof captureTrackViaDaemon;
  transcode: typeof transcode;
  tagMp3: typeof tagMp3;
  streamToWriter: typeof streamToWriter;
  retainCapture: (capturePath: string, trackId: string) => string;
}

const DEFAULT_DOWNLOAD_DEPENDENCIES: DownloadCommandDependencies = {
  ensureDirs,
  resolveInput,
  daemonApiHealthy,
  ping,
  makeTempRoot: () => mkdtempSync(join(tmpdir(), "soggfy-download-")),
  createSpotifyInstance: (socketPath, savePath) => new SpotifyInstance(socketPath, savePath),
  captureTrack,
  captureTrackViaDaemon,
  transcode,
  tagMp3,
  streamToWriter,
  retainCapture: retainStandaloneCapture,
};

export function createDownloadCommand(
  overrides: Partial<DownloadCommandDependencies> = {},
): (args: string[]) => Promise<void> {
  const deps: DownloadCommandDependencies = { ...DEFAULT_DOWNLOAD_DEPENDENCIES, ...overrides };
  return async (args: string[]): Promise<void> => {
    const { inputs, opts } = parseDownloadArgs(args);

    if (inputs.length === 0) {
      log.error("No track or playlist specified. Use 'soggfy download --help' for usage.");
      process.exit(1);
    }

    deps.ensureDirs();

    // Resolve all track IDs from inputs (tracks, albums, playlists)
    const allTrackIds: string[] = [];
    for (const input of inputs) {
      log.info(`Resolving tracks from input...`);
      const ids = await deps.resolveInput(input);
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
    let tempInstance: DownloadSpotifyInstance | null = null;
    let tempRoot: string | null = null;
    let useDaemon = Boolean(opts.useDaemon);

    if (useDaemon) {
      const schedulerAlive = await deps.daemonApiHealthy();
      if (!schedulerAlive) {
        const daemonIpcAlive = await deps.ping(IPC_SOCKET);
        if (daemonIpcAlive) {
          throw new Error("Spotify daemon IPC is active but its scheduler API is unavailable; refusing an unscheduled capture");
        }
        log.info("Daemon not running. Starting temporary Spotify instance...");
        useDaemon = false;
      }
    }

    if (!useDaemon) {
      tempRoot = deps.makeTempRoot();
      const tmpSocket = join(tempRoot, "ipc.sock");
      const tmpSave = join(tempRoot, "save");
      tempInstance = deps.createSpotifyInstance(tmpSocket, tmpSave);
      socketPath = tmpSocket;
      savePath = tmpSave;
    }

    try {
      if (tempInstance) {
        try {
          await tempInstance.start();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to start Spotify: ${detail}. Run 'soggfy install' first, then 'soggfy auth login'.`);
        }
      }

      for (let i = 0; i < allTrackIds.length; i++) {
        const trackId = allTrackIds[i];

        if (allTrackIds.length > 1) {
          log.header(`[${i + 1}/${allTrackIds.length}] Processing ${trackId}`);
        }

        let result: CaptureResult;
        try {
          result = useDaemon
            ? await deps.captureTrackViaDaemon(trackId)
            : await deps.captureTrack(socketPath, savePath, trackId);
        } catch (error) {
          if (!useDaemon) retainStandaloneCaptureCandidate(savePath, trackId, deps.retainCapture);
          throw error;
        }
        let outputSucceeded = false;
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
            if (!deps.transcode(result.wavPath, outputPath, opts.format!)) {
              throw new Error(`Transcoding failed for ${trackId}`);
            }
            if (opts.format === "mp3" && result.metadata) {
              await deps.tagMp3(outputPath, result.metadata);
            }
            log.ok(`Saved: ${outputPath}`);
          } else {
            const stdout = new WritableStream<Uint8Array>({
              write(chunk) { process.stdout.write(chunk); },
              close() {},
            });
            await deps.streamToWriter(result.wavPath, stdout, opts.format!);
          }
          outputSucceeded = true;
        } finally {
          if (!useDaemon && existsSync(result.wavPath)) {
            if (shouldRemoveCaptureAfterOutput({ keepCapture: Boolean(opts.keepWav), outputSucceeded })) {
              try { unlinkSync(result.wavPath); } catch {}
            } else {
              deps.retainCapture(result.wavPath, trackId);
            }
          }
        }
      }
    } finally {
      try {
        if (tempInstance) await tempInstance.stop();
      } finally {
        if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  };
}

export const downloadCommand = createDownloadCommand();
