import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("Ogg hook follows libogg success semantics and gates capture on complete hook installation", () => {
  const hook = source("soggfy-macos/Payload/DecodeHook.mm");
  expect(hook).toContain("ret != 0");
  expect(hook).toContain("!g_decoder_hooks_ready.load()");
  const readinessStore = hook.indexOf("g_decoder_hooks_ready.store");
  expect(readinessStore).toBeGreaterThan(-1);
  const partialInstall = hook.slice(readinessStore);
  expect(partialInstall).not.toContain("orig_DecodeAudioData = nullptr;");
  expect(partialInstall).not.toContain("orig_ogg_stream_pagein = nullptr;");
  expect(hook).toContain("g_decoder_hooks_ready.load()");
});

test("Ogg page validation permits empty bodies but rejects invalid body pointers and sizes", () => {
  const hook = source("soggfy-macos/Payload/DecodeHook.mm");
  expect(hook).toContain("blen < 0 || blen >= 1048576");
  expect(hook).toContain("blen > 0 && bdy == nullptr");
  expect(hook).not.toContain("blen <= 0 || blen >= 1048576");
  expect(hook).toContain("g_last_gated_sync_ms");
});

test("Ogg capture activity updates the audio watchdog", () => {
  const hook = source("soggfy-macos/Payload/DecodeHook.mm");
  const main = source("soggfy-macos/Payload/Main.mm");
  expect(main).toContain("MarkAudioActivity");
  expect(hook).toContain("MarkAudioActivity()");
});

test("IPC clients have a receive deadline", () => {
  const main = source("soggfy-macos/Payload/Main.mm");
  expect(main).toContain("SO_RCVTIMEO");
});

test("capture-owner cleanup preserves another live process owner and recovers stale owners", () => {
  const state = source("soggfy-macos/Payload/StateManager.cpp");
  expect(state).toContain("kill(owner.pid, 0)");
  expect(state).toContain("owner.pid == static_cast<int>(getpid())");
  expect(state).toContain("owner.playbackId == playbackId");
  expect(state).toContain("!CaptureOwnerProcessAlive(owner)");
  expect(state).toContain("ESRCH");
  expect(state).toContain("CaptureOwnerGuard");
  expect(state).toContain("ReleaseWriterLocked");
});

test("capture owners persist and validate kernel process birth identity", () => {
  const state = source("soggfy-macos/Payload/StateManager.cpp");
  expect(state).toContain("proc_pidinfo");
  expect(state).toContain("birthId");
  expect(state).toContain("owner.birthId.empty()");
  expect(state).toContain("return owner.birthId == currentBirthId");
});

test("non-BOS Ogg pages refresh shared capture state independent of cached gate state", () => {
  const hook = source("soggfy-macos/Payload/DecodeHook.mm");
  expect(hook).not.toContain("else if (g_capture_gated.load())");
  expect(hook).toContain("now - previous >= 200");
  const refresh = hook.indexOf("now - previous >= 200");
  const gatedRead = hook.indexOf("const bool gated = g_capture_gated.load()", refresh);
  expect(refresh).toBeGreaterThan(-1);
  expect(gatedRead).toBeGreaterThan(refresh);
});

test("writer release clears local ownership only after shared release succeeds", () => {
  const state = source("soggfy-macos/Payload/StateManager.cpp");
  const start = state.indexOf("void StateManager::ReleaseWriterLocked");
  const end = state.indexOf("bool StateManager::OwnsWriter", start);
  const release = state.slice(start, end);
  expect(release).toContain("if (!guard.locked()) return");
  expect(release).toContain("if (ownerExistsError) return");
  expect(release).toContain("if (removeError) return");
  const clear = release.indexOf("_ownerPid = 0");
  expect(clear).toBeGreaterThan(release.indexOf("if (!guard.locked()) return"));
  expect(clear).toBeGreaterThan(release.indexOf("if (removeError) return"));

  const resetStart = state.indexOf("void StateManager::ResetPlayback");
  const resetEnd = state.indexOf("void StateManager::CancelPlayback", resetStart);
  const reset = state.slice(resetStart, resetEnd);
  expect(reset).toContain("ReleaseWriterLocked(playbackId)");
  expect(reset).not.toContain("_ownerPid = 0");
});
