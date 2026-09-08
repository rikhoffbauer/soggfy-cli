import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const decodeHeader = readFileSync(join(root, "soggfy-macos/Payload/DecodeHook.h"), "utf8");
const decodeSource = readFileSync(join(root, "soggfy-macos/Payload/DecodeHook.mm"), "utf8");
const mainSource = readFileSync(join(root, "soggfy-macos/Payload/Main.mm"), "utf8");

test("native payload exposes decoder hook readiness separately from IPC readiness", () => {
  expect(decodeHeader).toContain("g_decoder_hooks_ready");
  expect(decodeSource).toContain("g_decoder_hooks_ready.store(decodeOk && oggOk)");
  expect(mainSource).toContain('req == "get_capabilities"');
  expect(mainSource).toContain('"hooksInitialized"');
  expect(mainSource).toContain('"decoderHooksReady"');
  expect(mainSource).toContain('CaptureBackendName(SelectedCaptureBackend())');
});
