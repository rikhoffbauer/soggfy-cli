import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createDownloadCommand, retainStandaloneCapture } from "../src/commands/download";

const TRACK_ID = "4PTG3Z6ehGkBFwjybzWkR8";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

type HarnessOptions = {
  keep?: boolean;
  transcodeSucceeds?: boolean;
  captureFails?: boolean;
  startFails?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "soggfy-download-lifecycle-"));
  roots.push(root);
  const tempRoot = join(root, "runtime");
  const retainedRoot = join(root, "retained");
  const output = join(root, "output.mp3");
  const retained: string[] = [];
  let stopped = 0;

  const command = createDownloadCommand({
    ensureDirs: () => undefined,
    resolveInput: async () => [TRACK_ID],
    makeTempRoot: () => {
      mkdirSync(tempRoot, { recursive: true });
      return tempRoot;
    },
    createSpotifyInstance: () => ({
      start: async () => {
        if (options.startFails) throw new Error("fixture instance start failure");
      },
      stop: async () => { stopped += 1; },
    }),
    captureTrack: async (_socketPath, savePath, trackId) => {
      mkdirSync(savePath, { recursive: true });
      const capturePath = join(savePath, `${trackId}.ogg`);
      writeFileSync(capturePath, "OggS-fixture");
      if (options.captureFails) throw new Error(`Captured audio failed validation; preserved at ${capturePath}`);
      return { trackId, wavPath: capturePath, bytesWritten: 12, metadata: {} };
    },
    transcode: (_inputPath, outputPath) => {
      if (options.transcodeSucceeds === false) return false;
      writeFileSync(outputPath, "encoded");
      return true;
    },
    tagMp3: async () => undefined,
    retainCapture: (capturePath, trackId) => {
      const path = retainStandaloneCapture(capturePath, trackId, retainedRoot);
      retained.push(path);
      return path;
    },
  });

  const args = ["--no-daemon", "-o", output];
  if (options.keep) args.push("--keep-wav");
  args.push(TRACK_ID);
  return { command, args, root, tempRoot, retained, output, stopped: () => stopped };
}

test("successful standalone download removes only the temporary capture and runtime", async () => {
  const h = createHarness();
  await h.command(h.args);
  expect(existsSync(h.output)).toBe(true);
  expect(existsSync(h.tempRoot)).toBe(false);
  expect(h.retained).toEqual([]);
  expect(h.stopped()).toBe(1);
});

test("--keep-wav persists the standalone capture outside the temporary runtime", async () => {
  const h = createHarness({ keep: true });
  await h.command(h.args);
  expect(existsSync(h.tempRoot)).toBe(false);
  expect(h.retained).toHaveLength(1);
  expect(existsSync(h.retained[0]!)).toBe(true);
});

test("transcode failure persists the validated capture before runtime cleanup", async () => {
  const h = createHarness({ transcodeSucceeds: false });
  await expect(h.command(h.args)).rejects.toThrow("Transcoding failed");
  expect(existsSync(h.tempRoot)).toBe(false);
  expect(h.retained).toHaveLength(1);
  expect(existsSync(h.retained[0]!)).toBe(true);
  expect(h.stopped()).toBe(1);
});

test("capture validation failure persists the produced capture before runtime cleanup", async () => {
  const h = createHarness({ captureFails: true });
  await expect(h.command(h.args)).rejects.toThrow("failed validation");
  expect(existsSync(h.tempRoot)).toBe(false);
  expect(h.retained).toHaveLength(1);
  expect(existsSync(h.retained[0]!)).toBe(true);
  expect(h.stopped()).toBe(1);
});

test("instance start failure removes the temporary runtime without claiming a retained capture", async () => {
  const h = createHarness({ startFails: true });
  await expect(h.command(h.args)).rejects.toThrow("fixture instance start failure");
  expect(existsSync(h.tempRoot)).toBe(false);
  expect(h.retained).toEqual([]);
  expect(h.stopped()).toBe(1);
});
