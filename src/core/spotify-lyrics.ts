import { getSpotifyWebTokens, SPOTIFY_WEB_USER_AGENT } from "./spotify-web-auth";

export interface SpotifyLyricsSyllable {
  startTimeMs?: number;
  endTimeMs?: number;
  text?: string;
}

export interface SpotifyLyricsLine {
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  syllables: SpotifyLyricsSyllable[];
}

export interface SpotifyLyrics {
  source: "spotify";
  trackId: string;
  syncType: string;
  language?: string;
  provider?: string;
  lines: SpotifyLyricsLine[];
}

export interface FetchSpotifyLyricsOptions {
  accessToken?: string;
  clientToken?: string;
  fetchImpl?: typeof fetch;
}
function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function numberValue(value: unknown): number {
  const result = typeof value === "number" ? value : Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(result) ? result : 0;
}

export function normalizeSpotifyLyricsResponse(trackId: string, response: unknown): SpotifyLyrics {
  const lyrics = asObject(asObject(response)?.lyrics);
  if (!lyrics || !Array.isArray(lyrics.lines)) {
    throw new Error("Spotify lyrics response did not contain lyrics lines");
  }
  const lines = lyrics.lines.map((entry): SpotifyLyricsLine | null => {
    const line = asObject(entry);
    if (!line || typeof line.words !== "string") return null;
    const syllables = Array.isArray(line.syllables)
      ? line.syllables.map((raw) => {
          const syllable = asObject(raw);
          if (!syllable) return null;
          return {
            ...(syllable.startTimeMs !== undefined ? { startTimeMs: numberValue(syllable.startTimeMs) } : {}),
            ...(syllable.endTimeMs !== undefined ? { endTimeMs: numberValue(syllable.endTimeMs) } : {}),
            ...(typeof syllable.words === "string" ? { text: syllable.words } : {}),
          };
        }).filter((value): value is SpotifyLyricsSyllable => value !== null)
      : [];
    return {
      startTimeMs: numberValue(line.startTimeMs),
      endTimeMs: numberValue(line.endTimeMs),
      text: line.words,
      syllables,
    };
  }).filter((value): value is SpotifyLyricsLine => value !== null);

  return {
    source: "spotify",
    trackId,
    syncType: typeof lyrics.syncType === "string" ? lyrics.syncType : "UNSYNCED",
    ...(typeof lyrics.language === "string" ? { language: lyrics.language } : {}),
    ...(typeof lyrics.provider === "string" ? { provider: lyrics.provider } : {}),
    lines,
  };
}

function lrcTimestamp(milliseconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(milliseconds / 10));
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

export function formatLyricsAsLrc(lyrics: SpotifyLyrics): string {
  return lyrics.lines.map((line) => `[${lrcTimestamp(line.startTimeMs)}]${line.text}`).join("\n");
}
export async function fetchSpotifyLyrics(
  trackId: string,
  options: FetchSpotifyLyricsOptions = {},
): Promise<SpotifyLyrics | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokens = options.accessToken && options.clientToken
    ? { accessToken: options.accessToken, clientToken: options.clientToken }
    : await getSpotifyWebTokens(fetchImpl);
  const url = new URL(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("vocalRemoval", "false");
  url.searchParams.set("market", "from_token");

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${tokens.accessToken}`,
      "client-token": tokens.clientToken,
      "app-platform": "WebPlayer",
      "user-agent": SPOTIFY_WEB_USER_AGENT,
    },
  });
  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Spotify lyrics request failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  try {
    return normalizeSpotifyLyricsResponse(trackId, JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Spotify lyrics returned invalid JSON: ${text.slice(0, 240)}`);
    }
    throw error;
  }
}
