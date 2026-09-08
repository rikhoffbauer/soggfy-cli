import { expect, test } from "bun:test";
import { formatLyricsOutput, parseLyricsArgs } from "../src/commands/lyrics";
import type { SpotifyLyrics } from "../src/core/spotify-lyrics";

const id = "3z8h0TU7ReDPLIbEnYhWZb";
const lyrics: SpotifyLyrics = {
  source: "spotify", trackId: id, syncType: "LINE_SYNCED", language: "en", provider: "MusixMatch",
  lines: [{ startTimeMs: 110, endTimeMs: 0, text: "Hello", syllables: [] }],
};

test("lyrics CLI accepts Spotify track IDs, URIs, and URLs", () => {
  expect(parseLyricsArgs([id]).trackId).toBe(id);
  expect(parseLyricsArgs([`spotify:track:${id}`, "--format", "lrc"])).toEqual({ trackId: id, format: "lrc" });
  expect(parseLyricsArgs([`https://open.spotify.com/track/${id}?si=x`, "--format", "json"])).toEqual({ trackId: id, format: "json" });
});

test("lyrics CLI rejects unsupported inputs and formats", () => {
  expect(() => parseLyricsArgs(["not-a-track"])).toThrow("Valid Spotify track");
  expect(() => parseLyricsArgs([id, "--format", "srt"])).toThrow("Unsupported lyrics format");
});

test("lyrics CLI formats JSON, LRC, and plain text", () => {
  expect(formatLyricsOutput(lyrics, "json")).toContain('"source": "spotify"');
  expect(formatLyricsOutput(lyrics, "lrc")).toBe("[00:00.11]Hello");
  expect(formatLyricsOutput(lyrics, "text")).toBe("Hello");
});
