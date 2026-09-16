import { expect, test } from "bun:test";
import { parsePlaybackConfirmation, requestTrackPlayback, waitForTrackCompletion } from "../src/core/capture-control";

const trackId = "4PTG3Z6ehGkBFwjybzWkR8";

test("playback confirmation requires the exact target, playing state and advancing position", () => {
  const playing = { uri: `spotify:track:${trackId}`, is_ad: false, gated: false, state: "playing", position: 1.5 };
  expect(parsePlaybackConfirmation(JSON.stringify(playing), trackId).confirmed).toBe(true);
  expect(parsePlaybackConfirmation(`spotify:track:${trackId}`, trackId).confirmed).toBe(false);
  expect(parsePlaybackConfirmation(JSON.stringify({ ...playing, state: "paused" }), trackId).confirmed).toBe(false);
  expect(parsePlaybackConfirmation(JSON.stringify({ ...playing, position: 0 }), trackId).confirmed).toBe(false);
  expect(parsePlaybackConfirmation(JSON.stringify({ ...playing, uri: `${playing.uri}extra` }), trackId).confirmed).toBe(false);
  expect(parsePlaybackConfirmation(JSON.stringify({ uri: playing.uri, is_ad: false, gated: false }), trackId).confirmed).toBe(false);
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


test("capture delegates playback to the checked playback helper without timed replay nudges", async () => {
  const source = await Bun.file(new URL("../src/core/capture.ts", import.meta.url)).text();
  expect(source).toContain("await requestTrackPlayback(");
  expect(source).not.toContain("Re-nudge play");
  expect(source).not.toContain("re-nudge play");
});


test("requestTrackPlayback retries only explicit IPC play failures", async () => {
  const responses = ["error:-1708", "ok"];
  const commands: string[] = [];
  await requestTrackPlayback(async (command) => {
    commands.push(command);
    return responses.shift() ?? "ok";
  }, trackId, { attempts: 3, delayMs: 1 });

  expect(commands).toEqual([
    `play spotify:track:${trackId}`,
    `play spotify:track:${trackId}`,
  ]);
});

test("requestTrackPlayback retries native errors that use an error-space prefix", async () => {
  const responses = ["error Spotify local control port 7768 is not owned by this instance", "ok"];
  const commands: string[] = [];
  await requestTrackPlayback(async (command) => {
    commands.push(command);
    return responses.shift() ?? "ok";
  }, trackId, { attempts: 3, delayMs: 1 });
  expect(commands).toHaveLength(2);
});

test("requestTrackPlayback never retries a successful play command", async () => {
  const commands: string[] = [];
  await requestTrackPlayback(async (command) => {
    commands.push(command);
    return "ok";
  }, trackId, { attempts: 3, delayMs: 1 });
  expect(commands).toHaveLength(1);
});

test("compatibility probe uses one end-to-end capture instead of preflight playback restart", async () => {
  const source = await Bun.file(new URL("../src/core/compat-probe.ts", import.meta.url)).text();
  expect(source).not.toContain("verifyTargetPlayback");
  expect((source.match(/await captureTrack\(/g) ?? []).length).toBe(1);
  expect(source).toContain("playbackAttempts: 20");
});
