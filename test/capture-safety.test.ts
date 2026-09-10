import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const cliCapture = readFileSync(join(root, "src/core/capture.ts"), "utf8");
const webCapture = readFileSync(join(root, "webapp/src/server/spotify-instance.ts"), "utf8");
const auth = readFileSync(join(root, "src/commands/auth.ts"), "utf8");

test("capture clients fail closed when target playback cannot be confirmed", () => {
  expect(cliCapture).toContain("was not confirmed playing");
  expect(webCapture).toContain("was not confirmed playing");
  expect(cliCapture).not.toContain("proceeding with fallback");
  expect(webCapture).not.toContain("proceeding with fallback");
  expect(cliCapture).not.toContain('active_track.txt');
});

test("capture clients wait for shared completion after finish_track", () => {
  expect(cliCapture).toContain("waitForTrackCompletion");
  expect(webCapture).toContain("waitForTrackCompletion");
  expect(cliCapture).not.toContain("await Bun.sleep(500);\n  }\n  await sendIPC(socketPath, \"pause\")");
});

test("auth cleanup targets the process tree it launched", () => {
  expect(auth).toContain("terminateProcessTree(spotify.pid, spotify.exited)");
  expect(auth).not.toContain("killall");
});

const nativePayload = readFileSync(join(root, "soggfy-macos/Payload/Main.mm"), "utf8");

function nativeSection(start: string, end: string) {
  return nativePayload.slice(nativePayload.indexOf(start), nativePayload.indexOf(end));
}

test("capture gate publication serializes epoch allocation through atomic rename", () => {
  const section = nativeSection("static void PersistCaptureGate", "static void PersistActiveTrackId");
  const lock = section.indexOf("g_capture_gate_publish_mutex");
  const store = section.indexOf("g_capture_gated.store(gated)");
  const epoch = section.indexOf("g_capture_gate_epoch.fetch_add");
  const publish = section.indexOf("WritePrivateSharedFile");
  expect(lock).toBeGreaterThanOrEqual(0);
  expect(store).toBeGreaterThan(lock);
  expect(epoch).toBeGreaterThan(store);
  expect(publish).toBeGreaterThan(epoch);
  expect(nativePayload.match(/g_capture_gated\.store\((?:true|false)\)/g) ?? []).toHaveLength(0);
});

test("get_playing cannot block the IPC server indefinitely on the main queue", () => {
  const section = nativeSection('req == "get_playing"', 'SendResponse(client_fd, "error unknown command")');
  expect(section).not.toContain("dispatch_sync(dispatch_get_main_queue()");
  expect(section).toContain("dispatch_async(dispatch_get_main_queue()");
  expect(section).toContain("ready.wait_for");
  expect(section).toContain("std::chrono::milliseconds(750)");
  expect(section).toContain('state_value = @"unknown"');
});
