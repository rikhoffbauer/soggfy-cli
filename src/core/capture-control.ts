export interface PlaybackConfirmation {
  confirmed: boolean;
  isAd: boolean;
  gated: boolean;
  uri: string;
  fileId?: string;
  fileBitrate?: number;
}

export function parsePlaybackConfirmation(response: string, trackId: string): PlaybackConfirmation {
  const raw = response.trim();
  if (!raw) return { confirmed: false, isAd: false, gated: false, uri: "" };

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as {
        uri?: unknown;
        is_ad?: unknown;
        gated?: unknown;
        state?: unknown;
        position?: unknown;
        fileId?: unknown;
        file_id?: unknown;
        fileBitrate?: unknown;
        file_bitrate?: unknown;
      };
      const uri = typeof parsed.uri === "string" ? parsed.uri : "";
      const isAd = parsed.is_ad === true;
      const gated = parsed.gated === true;
      const advancing = parsed.state === "playing" && typeof parsed.position === "number" && Number.isFinite(parsed.position) && parsed.position > 0.1;
      const fileIdValue = parsed.fileId ?? parsed.file_id;
      const fileBitrateValue = parsed.fileBitrate ?? parsed.file_bitrate;
      const fileId = typeof fileIdValue === "string" && /^[0-9a-f]{40}$/i.test(fileIdValue)
        ? fileIdValue
        : undefined;
      const fileBitrateNumber = Number(fileBitrateValue);
      const fileBitrate = Number.isFinite(fileBitrateNumber) && fileBitrateNumber > 0
        ? fileBitrateNumber
        : undefined;
      return {
        confirmed: !isAd && !gated && uri === `spotify:track:${trackId}` && advancing,
        isAd,
        gated,
        uri,
        fileId,
        fileBitrate,
      };
    } catch {
      return { confirmed: false, isAd: false, gated: false, uri: "" };
    }
  }

  return { confirmed: false, isAd: false, gated: false, uri: raw };
}


export async function requestTrackPlayback(
  sendCommand: (command: string) => Promise<string>,
  trackId: string,
  { attempts = 3, delayMs = 500 }: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  let lastResponse = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    lastResponse = (await sendCommand(`play spotify:track:${trackId}`)).trim();
    if (lastResponse === "ok") return;
    if (!/^error(?::|\s)/.test(lastResponse)) {
      throw new Error(`Unexpected Spotify play response: ${lastResponse || "<empty>"}`);
    }
    if (attempt + 1 < attempts) await Bun.sleep(delayMs);
  }
  throw new Error(`Spotify play command failed after ${attempts} attempt(s): ${lastResponse}`);
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
