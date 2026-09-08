import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { sendIPC } from "./ipc";
import { log } from "./log";
import { fetchTrackMetadata, type TrackMetadata } from "./metadata";
import { validateAudioFile } from "./media";

export interface CaptureResult {
  trackId: string;
  wavPath: string;
  bytesWritten: number;
  durationMs?: number;
  metadata: TrackMetadata;
}

export async function captureTrack(
  socketPath: string,
  savePath: string,
  trackId: string,
): Promise<CaptureResult> {
  // Fetch metadata in parallel
  const metadataPromise = fetchTrackMetadata(trackId);

  // Reset and prepare
  await sendIPC(socketPath, `reset_track ${trackId}`);
  await sendIPC(socketPath, `set_track ${trackId}`);

  // Tell Spotify to play the track
  await sendIPC(socketPath, `play spotify:track:${trackId}`);
  log.info(`Playback started for ${trackId}`);

  // Wait for the correct track to be confirmed playing
  let trackConfirmed = false;
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(500);
    try {
      const playingUri = await sendIPC(socketPath, "get_playing").catch(() => "");
      if (playingUri && playingUri.includes(trackId)) {
        trackConfirmed = true;
        break;
      }
      const notifyFile = join(savePath, "active_track.txt");
      if (existsSync(notifyFile)) {
        const fileContent = readFileSync(notifyFile, "utf-8").trim();
        if (fileContent.includes(trackId)) {
          trackConfirmed = true;
          break;
        }
      }
    } catch {}

    // Re-nudge play every 3 seconds if not confirmed yet
    if (i > 0 && i % 6 === 0 && !trackConfirmed) {
      await sendIPC(socketPath, `play spotify:track:${trackId}`).catch(() => {});
    }
  }

  if (!trackConfirmed) {
    log.warn("Track not confirmed via notification, proceeding with fallback");
  }

  // Wait for capture to start
  let status = "idle";
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(500);
    status = await sendIPC(socketPath, `get_status ${trackId}`, { retries: 1 }).catch(() => "idle");
    if (status === "downloading" || status === "completed") break;

    // If still idle, re-nudge play
    if (i > 0 && i % 6 === 0) {
      await sendIPC(socketPath, `play spotify:track:${trackId}`).catch(() => {});
    }
  }

  if (status !== "downloading" && status !== "completed") {
    await sendIPC(socketPath, "pause").catch(() => {});
    throw new Error("Audio interception timed out before capture started");
  }

  // Set duration limit if we have metadata
  const metadata = await metadataPromise;
  const durationMs = metadata.durationMs;
  if (durationMs && durationMs > 0) {
    await sendIPC(socketPath, `set_duration ${trackId} ${durationMs}`).catch(() => {});
  }

  log.info(`Capturing audio${durationMs ? ` (~${Math.round(durationMs / 1000)}s)` : ""}...`);

  // Monitor capture progress
  const maxCaptureMs = Math.max((durationMs || 240000) + 30000, 90000);
  const started = Date.now();
  let lastBytes = -1;
  let stagnantTicks = 0;
  let ipcLossTicks = 0;
  const oggPath = join(savePath, `${trackId}.ogg`);
  const wavPath = join(savePath, `${trackId}.wav`);

  while (status !== "completed" && Date.now() - started < maxCaptureMs) {
    await Bun.sleep(250);
    const newStatus = await sendIPC(socketPath, `get_status ${trackId}`, { retries: 2, timeoutMs: 1500 }).catch(() => "ipc_lost");
    if (newStatus === "ipc_lost") {
      if (++ipcLossTicks >= 12) throw new Error("IPC lost during capture");
    } else {
      ipcLossTicks = 0;
      status = newStatus;
    }

    const currentPath = existsSync(oggPath) ? oggPath : wavPath;
    const isOgg = currentPath.endsWith(".ogg");
    const bytes = existsSync(currentPath) ? statSync(currentPath).size : 0;

    let expectedBytes = 0;
    if (durationMs) {
      // 320 kbps Vorbis stream is ~40 KB/s; 32-bit Float PCM is ~352.8 KB/s
      expectedBytes = isOgg
        ? Math.floor((320 * 1024 / 8 * durationMs) / 1000)
        : Math.floor((44100 * 2 * 4 * durationMs) / 1000);
      log.progress("Capturing", bytes, expectedBytes);
    }

    if (expectedBytes > 0 && bytes >= expectedBytes) {
      log.ok("Track stream capture completed!");
      break;
    }

    if (bytes === lastBytes) stagnantTicks++;
    else stagnantTicks = 0;
    lastBytes = bytes;

    if (stagnantTicks >= 40 && bytes > 0) {
      log.warn("Capture stagnant — finalizing");
      break;
    }
  }

  // Finalize
  if (status !== "completed") {
    await sendIPC(socketPath, `finish_track ${trackId}`).catch(() => {});
    await Bun.sleep(500);
  }
  await sendIPC(socketPath, "pause").catch(() => {});

  const finalPath = existsSync(oggPath) ? oggPath : wavPath;
  if (!existsSync(finalPath)) {
    throw new Error("Output audio file not found after capture");
  }

  const bytesWritten = statSync(finalPath).size;
  const validation = validateAudioFile(finalPath, durationMs);
  if (!validation.ok) {
    throw new Error(
      `Captured audio failed validation (${validation.warnings.join(", ")}); preserved at ${finalPath}`,
    );
  }
  log.ok(`Captured ${(bytesWritten / 1024 / 1024).toFixed(1)} MB of validated audio`);

  return {
    trackId,
    wavPath: finalPath,
    bytesWritten,
    durationMs,
    metadata,
  };
}
