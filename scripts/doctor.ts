#!/usr/bin/env bun
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { CAPTURE_BACKEND, OUTPUT_DIR, PATCHED_APP } from "../src/core/paths";
import { readSpotifyBundleVersion } from "../src/core/spotify-runtime";
import { isSpotifyVersionSupported, supportedSpotifyVersions } from "../src/core/spotify-compatibility";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, "..");
const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

function commandOk(cmd: string, args?: string[]) {
  const defaultArgs = cmd === "ffmpeg" || cmd === "ffprobe" || cmd === "fpcalc"
    ? ["-version"]
    : cmd === "codesign" ? ["-h"] : ["--version"];
  const result = spawnSync(cmd, args ?? defaultArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ok = cmd === "codesign"
    ? result.status === 0 || (result.stderr || "").includes("Usage: codesign")
    : result.status === 0;
  return { ok, detail: (result.stdout || result.stderr || "").split("\n")[0] };
}

function add(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
}

for (const cmd of ["bun", "cmake", "ffmpeg", "ffprobe", "fpcalc", "codesign"]) {
  const res = commandOk(cmd);
  add(`command:${cmd}`, res.ok, res.detail);
}

const patchedBinary = join(PATCHED_APP, "Contents/MacOS/Spotify");
const bundledPayload = join(PATCHED_APP, "Contents/MacOS/libsoggfy.dylib");
add("spotify:system-app", existsSync("/Applications/Spotify.app/Contents/MacOS/Spotify"));
const systemVersion = readSpotifyBundleVersion("/Applications/Spotify.app");
add("spotify:version", Boolean(systemVersion && isSpotifyVersionSupported(systemVersion)), `${systemVersion ?? "unknown"} (supported exact builds: ${supportedSpotifyVersions().join(", ")})`);
add("workspace:patched-app", existsSync(patchedBinary), patchedBinary);
const patchedVersion = readSpotifyBundleVersion(PATCHED_APP);
add("workspace:version", Boolean(patchedVersion && isSpotifyVersionSupported(patchedVersion)), `${patchedVersion ?? "unknown"} (supported exact builds: ${supportedSpotifyVersions().join(", ")})`);
add("payload:build-output", existsSync(join(root, "soggfy-macos/build/libsoggfy.dylib")));
add("payload:bundle-copy", existsSync(bundledPayload), bundledPayload);
add("webapp:package", existsSync(join(root, "webapp/package.json")));
add("webapp:node-modules", existsSync(join(root, "webapp/node_modules")));

let outputWritable = false;
const probePath = join(OUTPUT_DIR, `.doctor-${process.pid}`);
try {
  mkdirSync(OUTPUT_DIR, { recursive: true, mode: 0o700 });
  await Bun.write(probePath, "ok\n");
  outputWritable = true;
} catch {}
finally { try { unlinkSync(probePath); } catch {} }
add("output:writable", outputWritable, OUTPUT_DIR);
add("config:capture-backend", CAPTURE_BACKEND === "ogg" || CAPTURE_BACKEND === "disabled", CAPTURE_BACKEND);

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "✓" : "✗"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll doctor checks passed.");
