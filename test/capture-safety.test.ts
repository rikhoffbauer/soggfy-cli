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


test("native source investigation tracing remains opt-in and bounded", () => {
  const decodeSource = Bun.file(new URL("../soggfy-macos/Payload/DecodeHook.mm", import.meta.url));
  return decodeSource.text().then((source) => {
    expect(source).toContain('getenv("SOGGFY_INVESTIGATE_OGG_CONTEXT")');
    expect(source).toContain("kMaxInvestigationStreams = 16");
    expect(source).toContain("kMaxInvestigationDecoders = 32");
    expect(source).toContain("kMaxProductionDecodeSpeed = 64.0");
    expect(source).toContain("kMaxInvestigationDecodeSpeed = 256.0");
    expect(source).toContain('getenv("SOGGFY_INVESTIGATION_ALLOW_HIGH_DECODE_SPEED")');
    expect(source).toContain('getenv("SOGGFY_INVESTIGATE_DECODE_INPUT")');
    expect(source).toContain('getenv("SOGGFY_INVESTIGATE_NATIVE_SOURCE")');
    expect(source).toContain("kMaxInvestigationNativeSources = 16");
    expect(source).toContain("0x11f029c");
    expect(source).toContain("0x11f05ec");
    expect(source).toContain("0x11f0974");
    expect(source).toContain("0x11ee890");
    expect(source).toContain("source_late_peek");
    expect(source).toContain("source_late_consume");
    expect(source).toContain("kMaxInvestigationDecodeInputBytes");
    expect(source).toContain("64ULL * 1024ULL * 1024ULL");
    expect(source).toContain("InvestigationCaptureDecodeInput(");
    expect(source).toContain("InvestigationResetDecodeInput()");
    expect(source).toContain("decoderPtr, x3, encodedRead");
    expect(source).toContain("kSpotify130277OggStateOffset = 0x88");
    expect(source).toContain('firstDecoderCall ? "decode_first"');
    expect(source).toContain('eosSeenInCall ? "decode_eos_return" : "decode_progress"');
    expect(source).toContain("firstStackCount = backtrace(firstStack, 16)");
    expect(source).toContain('(snapshot.calls % 128) == 0');
    expect(source).toContain('(it->second.pages % 128) == 0');
  });
});

test("native source exact identity binding is construction-scoped and independent of global playback", async () => {
  const source = await Bun.file(new URL("../soggfy-macos/Payload/DecodeHook.mm", import.meta.url)).text();
  const start = source.indexOf("static void InvestigationPlaybackBackendAssignProbe(");
  const end = source.indexOf("static void InvestigationSourcePublishHandleProbe(", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const binding = source.slice(start, end);

  expect(source).toContain('#include "NativeSourceIdentity.h"');
  expect(source).toContain("InvestigationIdentityScopeEnter(0xc9cdd4)");
  expect(source).toContain("InvestigationIdentityScopeEnter(0x656d1c)");
  expect(source).toContain("CanBindExactNativeSourceIdentity(bindingInput)");
  expect(source).toContain('"source_identity_bound"');
  expect(binding).not.toContain("g_active_track_id");
  expect(binding).not.toContain("g_track_mutex");
  expect(binding).toContain("pending.identityScopeToken");
  expect(binding).toContain("pending.identityScopeSiteOffset");
  expect(binding).toContain("sharedCaller != 0");
  expect(binding).toContain("it->second.generation == pendingGeneration");
  expect(binding).toContain("!it->second.fileId.empty()");

  const newStateStart = source.indexOf(
    "static InvestigationNativeSourceState InvestigationNewNativeSourceState(",
  );
  const newStateEnd = source.indexOf(
    "static std::string InvestigationFileIdHex(",
    newStateStart,
  );
  const newState = source.slice(newStateStart, newStateEnd);
  expect(newState).not.toContain("state.fileId =");

  const ownerStart = source.indexOf("static uintptr_t my_InvestigationOwnerConstructor(");
  const ownerEnd = source.indexOf(
    "static uintptr_t my_InvestigationSourceInit(",
    ownerStart,
  );
  const ownerConstructor = source.slice(ownerStart, ownerEnd);
  expect(ownerConstructor).not.toContain("it->second.fileId =");
  expect(ownerConstructor).not.toContain('"source_identity_bound"');
  expect(ownerConstructor).toContain('"owner_ctor_identity_hint"');

  const authoritativeBindings = source.match(/"source_identity_bound"/g) ?? [];
  expect(authoritativeBindings).toHaveLength(1);
});
