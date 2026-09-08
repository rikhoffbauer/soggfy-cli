export interface PlaybackConfirmation {
  confirmed: boolean;
  isAd: boolean;
  gated: boolean;
  uri: string;
}

export function parsePlaybackConfirmation(response: string, trackId: string): PlaybackConfirmation {
  const raw = response.trim();
  if (!raw) return { confirmed: false, isAd: false, gated: false, uri: "" };

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { uri?: unknown; is_ad?: unknown; gated?: unknown };
      const uri = typeof parsed.uri === "string" ? parsed.uri : "";
      const isAd = parsed.is_ad === true;
      const gated = parsed.gated === true;
      return { confirmed: !isAd && !gated && uri.includes(trackId), isAd, gated, uri };
    } catch {
      return { confirmed: false, isAd: false, gated: false, uri: "" };
    }
  }

  return { confirmed: raw.includes(trackId), isAd: false, gated: false, uri: raw };
}

export async function waitForTrackCompletion(
  sendCommand: (command: string) => Promise<string>,
  trackId: string,
  { attempts = 20, delayMs = 250 }: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const status = await sendCommand(`get_status ${trackId}`).catch(() => "");
    if (status === "completed") return true;
    if (status === "cancelled") return false;
    if (attempt + 1 < attempts) await Bun.sleep(delayMs);
  }
  return false;
}
