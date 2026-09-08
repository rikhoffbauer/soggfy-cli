import { expect, test } from "bun:test";
import { parsePlaybackConfirmation, waitForTrackCompletion } from "../src/core/capture-control";

const trackId = "4PTG3Z6ehGkBFwjybzWkR8";

test("playback confirmation accepts plain and ungated JSON target responses", () => {
  expect(parsePlaybackConfirmation(`spotify:track:${trackId}`, trackId).confirmed).toBe(true);
  expect(parsePlaybackConfirmation(JSON.stringify({ uri: `spotify:track:${trackId}`, is_ad: false, gated: false }), trackId).confirmed).toBe(true);
  expect(parsePlaybackConfirmation(JSON.stringify({ uri: `spotify:track:${trackId}`, is_ad: false, gated: true }), trackId).confirmed).toBe(false);
  expect(parsePlaybackConfirmation(JSON.stringify({ uri: "spotify:ad:1", is_ad: true, gated: false }), trackId).confirmed).toBe(false);
});

test("waitForTrackCompletion polls until shared status is completed", async () => {
  const statuses = ["downloading", "downloading", "completed"];
  let calls = 0;
  const ok = await waitForTrackCompletion(async () => statuses[calls++] ?? "completed", trackId, { attempts: 4, delayMs: 1 });
  expect(ok).toBe(true);
  expect(calls).toBe(3);
});

test("waitForTrackCompletion fails closed on cancelled or timeout", async () => {
  expect(await waitForTrackCompletion(async () => "cancelled", trackId, { attempts: 2, delayMs: 1 })).toBe(false);
  expect(await waitForTrackCompletion(async () => "downloading", trackId, { attempts: 2, delayMs: 1 })).toBe(false);
});
