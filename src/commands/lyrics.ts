import { fetchSpotifyLyrics, formatLyricsAsLrc, type SpotifyLyrics } from "../core/spotify-lyrics";
import { parseTrackId } from "../core/spotify-url";

export type LyricsFormat = "text" | "json" | "lrc";
export interface LyricsArgs {
  trackId: string;
  format: LyricsFormat;
}

export function parseLyricsArgs(args: string[]): LyricsArgs {
  let input: string | undefined;
  let format: LyricsFormat = "text";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--format" || arg === "-f") {
      const value = args[++i];
      if (value !== "text" && value !== "json" && value !== "lrc") {
        throw new Error(`Unsupported lyrics format: ${value ?? "missing"}`);
      }
      format = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown lyrics option: ${arg}`);
    } else if (!input) {
      input = arg;
    } else {
      throw new Error(`Unexpected lyrics argument: ${arg}`);
    }
  }
  const trackId = input ? parseTrackId(input) : null;
  if (!trackId) throw new Error("Valid Spotify track ID, URI, or URL is required");
  return { trackId, format };
}

export function formatLyricsOutput(lyrics: SpotifyLyrics, format: LyricsFormat): string {
  if (format === "json") return JSON.stringify(lyrics, null, 2);
  if (format === "lrc") return formatLyricsAsLrc(lyrics);
  return lyrics.lines.map((line) => line.text).join("\n");
}

export async function lyricsCommand(args: string[]): Promise<void> {
  const parsed = parseLyricsArgs(args);
  const lyrics = await fetchSpotifyLyrics(parsed.trackId);
  if (!lyrics) throw new Error(`Spotify lyrics unavailable for track ${parsed.trackId}`);
  process.stdout.write(`${formatLyricsOutput(lyrics, parsed.format)}\n`);
}
