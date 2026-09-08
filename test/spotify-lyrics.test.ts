import { expect, test } from "bun:test";
import { fetchSpotifyLyrics, formatLyricsAsLrc, normalizeSpotifyLyricsResponse } from "../src/core/spotify-lyrics";

const trackId = "3z8h0TU7ReDPLIbEnYhWZb";
const rawResponse = {
  lyrics: {
    syncType: "LINE_SYNCED",
    language: "en",
    provider: "MusixMatch",
    lines: [
      { startTimeMs: "110", endTimeMs: "6990", words: "Is this the real life?", syllables: [] },
      { startTimeMs: "6990", endTimeMs: "0", words: "Caught in a landslide", syllables: [] },
    ],
  },
};

test("normalizes Spotify line-synced lyrics without changing timestamps", () => {
  expect(normalizeSpotifyLyricsResponse(trackId, rawResponse)).toEqual({
    source: "spotify",
    trackId,
    syncType: "LINE_SYNCED",
    language: "en",
    provider: "MusixMatch",
    lines: [
      { startTimeMs: 110, endTimeMs: 6990, text: "Is this the real life?", syllables: [] },
      { startTimeMs: 6990, endTimeMs: 0, text: "Caught in a landslide", syllables: [] },
    ],
  });
});

test("formats normalized Spotify lyrics as standard LRC timestamps", () => {
  const lyrics = normalizeSpotifyLyricsResponse(trackId, rawResponse);
  expect(formatLyricsAsLrc(lyrics)).toBe("[00:00.11]Is this the real life?\n[00:06.99]Caught in a landslide");
});

test("fetchSpotifyLyrics sends the WebPlayer authorization request and returns null on 404", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const accessToken = "lyrics-access";
  const clientToken = "lyrics-client";
  const okFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(rawResponse), { status: 200 });
  }) as typeof fetch;
  const lyrics = await fetchSpotifyLyrics(trackId, { accessToken, clientToken, fetchImpl: okFetch });
  expect(lyrics?.syncType).toBe("LINE_SYNCED");
  expect(calls[0]?.url).toContain(`/color-lyrics/v2/track/${trackId}`);
  expect(calls[0]?.url).toContain("market=from_token");
  expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${accessToken}`);
  expect(calls[0]?.headers.get("app-platform")).toBe("WebPlayer");
  expect(calls[0]?.headers.get("client-token")).toBe(clientToken);

  const missing = await fetchSpotifyLyrics(trackId, {
    accessToken, clientToken,
    fetchImpl: (async () => new Response("", { status: 404 })) as typeof fetch,
  });
  expect(missing).toBeNull();
});
