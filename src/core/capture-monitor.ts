export type CaptureMonitorDecision = "continue" | "completed" | "deadline";

export function captureMaxWaitMs(durationMs?: number | null): number {
  return Math.max((durationMs || 240_000) + 30_000, 90_000);
}

export function captureMonitorDecision(
  status: string,
  elapsedMs: number,
  maxWaitMs: number,
): CaptureMonitorDecision {
  if (status === "completed") return "completed";
  if (elapsedMs >= maxWaitMs) return "deadline";
  return "continue";
}

export class PlaybackProgressMonitor {
  private lastPosition = -1;
  private lastBytes = 0;
  private lastAdvance: number;

  constructor(private readonly trackId: string, now = Date.now()) {
    this.lastAdvance = now;
  }

  observeCaptureBytes(bytes: number, now = Date.now()): void {
    if (bytes > this.lastBytes) {
      this.lastBytes = bytes;
      this.lastAdvance = now;
    }
  }

  observe(response: string, now = Date.now()): void {
    let reason = "playback telemetry unavailable";
    try {
      const value: unknown = JSON.parse(response);
      if (value && typeof value === "object" && "uri" in value && "state" in value && "position" in value) {
        if (value.uri !== `spotify:track:${this.trackId}`) reason = "target track is no longer playing";
        else if (value.state !== "playing") reason = `player is ${String(value.state)}`;
        else if (typeof value.position === "number" && Number.isFinite(value.position)) {
          reason = "playback position has not advanced";
          if (value.position > this.lastPosition + 0.1) {
            this.lastPosition = value.position;
            this.lastAdvance = now;
          }
        }
      }
    } catch { /* A missing snapshot cannot reset the progress deadline. */ }
    if (now - this.lastAdvance >= 30_000) throw new Error(`Spotify stalled: ${reason} for 30 seconds`);
  }
}
