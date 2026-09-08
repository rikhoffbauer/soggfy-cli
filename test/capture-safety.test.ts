import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const cliCapture = readFileSync(join(root, "src/core/capture.ts"), "utf8");
const webCapture = readFileSync(join(root, "webapp/src/index.ts"), "utf8");
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
