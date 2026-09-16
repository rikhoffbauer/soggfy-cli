import { existsSync, statSync } from "fs";
import { join } from "path";
import { sendIPC as rawSendIPC } from "./ipc";
import { parsePlaybackConfirmation, requestTrackPlayback, waitForTrackCompletion } from "./capture-control";
import { log } from "./log";
import { fetchTrackMetadata, type TrackMetadata } from "./metadata";
import { validateAudioFile } from "./media";
import { captureMaxWaitMs, captureMonitorDecision, PlaybackProgressMonitor } from "./capture-monitor";
import { CaptureTraceRecorder } from "./capture-trace";

export interface CaptureResult {
  trackId: string;
  wavPath: string;
  bytesWritten: number;
  durationMs?: number;
  metadata: TrackMetadata;
}

export interface CaptureOptions {
  playbackAttempts?: number;
  playbackDelayMs?: number;
}

export async function captureTrack(
  socketPath: string,
  savePath: string,
  trackId: string,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  const trace = new CaptureTraceRecorder(trackId);
  const tracedSend = async (
    command: string,
    options?: Parameters<typeof rawSendIPC>[2],
  ): Promise<string> => {
    trace.command(command);
    const response = await rawSendIPC(socketPath, command, options);
    trace.response(command, response);
    return response;
  };
  trace.record({ type: "phase", phase: "prepare" });
  log.info(`Capture trace: ${trace.path}`);

  // Fetch metadata in parallel
  const metadataPromise = fetchTrackMetadata(trackId);

  // Reset and prepare
  await tracedSend(`reset_track ${trackId}`);
  await tracedSend(`set_track ${trackId}`);

  // Tell Spotify to play the track
  trace.record({ type: "phase", phase: "awaiting_playback" });
  await requestTrackPlayback((command) => tracedSend(command), trackId, {
    attempts: options.playbackAttempts ?? 3,
    delayMs: options.playbackDelayMs ?? 500,
  });
  log.info(`Playback started for ${trackId}`);

  // Wait for the correct track to be confirmed playing
  let trackConfirmed = false;
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(500);
    try {
      const playingRaw = await tracedSend("get_playing").catch(() => "");
      trace.record({ type: "playback", raw: playingRaw });
      if (parsePlaybackConfirmation(playingRaw, trackId).confirmed) {
        trackConfirmed = true;
        break;
      }
    } catch {}

    // Never blindly re-send `play`: Spotify treats repeated play-context events
    // as seeks back to 0 for some tracks. A late playback notification should
    // time out rather than turning playback into a restart loop.
  }

  if (!trackConfirmed) {
    trace.record({ type: "timeout", prerequisite: "target playback confirmation", elapsedMs: 15_000 });
    await tracedSend("pause").catch(() => {});
    throw new Error(`Target track ${trackId} was not confirmed playing; trace: ${trace.path}`);
  }

  trace.record({ type: "phase", phase: "awaiting_capture" });
  // Wait for capture to start
  let status = "idle";
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(500);
    status = await tracedSend(`get_status ${trackId}`, { retries: 1 }).catch(() => "idle");
    trace.record({ type: "status", status });
    if (status === "downloading" || status === "completed") break;

    // Do not re-send `play` after the target is confirmed. Spotify treats that
    // command as a restart for some tracks, producing a 0s -> ~2s loop while
    // the capture backend is still waiting to claim the stream.
  }

  if (status !== "downloading" && status !== "completed") {
    trace.record({ type: "timeout", prerequisite: "audio interception", elapsedMs: 25_000 });
    await tracedSend("pause").catch(() => {});
    throw new Error(`Audio interception timed out before capture started; trace: ${trace.path}`);
  }
  trace.record({ type: "phase", phase: "capturing" });

  // Set duration limit if we have metadata
  const metadata = await metadataPromise;
  const durationMs = metadata.durationMs;
  if (durationMs && durationMs > 0) {
    await tracedSend(`set_duration ${trackId} ${durationMs}`).catch(() => {});
  }

  log.info(`Capturing audio${durationMs ? ` (~${Math.round(durationMs / 1000)}s)` : ""}...`);

  // Monitor capture progress
  const maxCaptureMs = captureMaxWaitMs(durationMs);
  const started = Date.now();
  const playback = new PlaybackProgressMonitor(trackId, started);
  let ipcLossTicks = 0;
  const oggPath = join(savePath, `${trackId}.ogg`);
  const wavPath = join(savePath, `${trackId}.wav`);

  while (captureMonitorDecision(status, Date.now() - started, maxCaptureMs) === "continue") {
    await Bun.sleep(250);
    const newStatus = await tracedSend(`get_status ${trackId}`, { retries: 2, timeoutMs: 1500 }).catch(() => "ipc_lost");
    if (newStatus === "ipc_lost") {
      if (++ipcLossTicks >= 12) {
        trace.record({ type: "error", message: "IPC lost during capture" });
        await tracedSend(`cancel_track ${trackId}`).catch(() => {});
        await tracedSend("pause").catch(() => {});
        throw new Error(`IPC lost during capture; trace: ${trace.path}`);
      }
    } else {
      ipcLossTicks = 0;
      status = newStatus;
      trace.record({ type: "status", status });
      if (status !== "completed") {
        try {
          const playbackRaw = await tracedSend("get_playing", { retries: 1 }).catch(() => "{}");
          trace.record({ type: "playback", raw: playbackRaw });
          playback.observe(playbackRaw);
        } catch (error) {
          await tracedSend(`cancel_track ${trackId}`).catch(() => {});
          await tracedSend("pause").catch(() => {});
          throw error;
        }
      }
    }

    const currentPath = existsSync(oggPath) ? oggPath : wavPath;
    const isOgg = currentPath.endsWith(".ogg");
    let bytes = 0;
    try { bytes = statSync(currentPath).size; } catch {}
    trace.record({ type: "bytes", path: currentPath, bytes });
    playback.observeCaptureBytes(bytes);

    let expectedBytes = 0;
    if (durationMs) {
      // 320 kbps Vorbis stream is ~40 KB/s; 32-bit Float PCM is ~352.8 KB/s
      expectedBytes = isOgg
        ? Math.floor((320 * 1024 / 8 * durationMs) / 1000)
        : Math.floor((44100 * 2 * 4 * durationMs) / 1000);
      log.progress("Capturing", bytes, expectedBytes);
    }

  }

  // Finalize
  trace.record({ type: "phase", phase: "finalizing" });
  if (status !== "completed") {
    await tracedSend(`finish_track ${trackId}`).catch(() => {});
    const completed = await waitForTrackCompletion(
      (command) => tracedSend(command, { retries: 1, timeoutMs: 1000 }),
      trackId,
    );
    if (!completed) {
      trace.record({ type: "timeout", prerequisite: "capture finalization", elapsedMs: 5_000 });
      await tracedSend("pause").catch(() => {});
      throw new Error(`Capture finalization timed out for ${trackId}; trace: ${trace.path}`);
    }
    status = "completed";
  }
  await tracedSend("pause").catch(() => {});

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
  trace.record({ type: "phase", phase: "completed" });
  log.ok(`Captured ${(bytesWritten / 1024 / 1024).toFixed(1)} MB of validated audio`);

  return {
    trackId,
    wavPath: finalPath,
    bytesWritten,
    durationMs,
    metadata,
  };
}
