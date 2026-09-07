#!/usr/bin/env bun
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, "..");
const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

function commandOk(cmd: string, args?: string[]) {
  const defaultArgs = cmd === "ffmpeg" || cmd === "ffprobe" ? ["-version"] : cmd === "codesign" ? ["-h"] : ["--version"];
  const finalArgs = args ?? defaultArgs;
  const result = spawnSync(cmd, finalArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const ok = cmd === "codesign" ? result.status === 0 || (result.stderr || "").includes("Usage: codesign") : result.status === 0;
  return { ok, detail: (result.stdout || result.stderr || "").split("\n")[0] };
}

function add(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
}

for (const cmd of ["bun", "cmake", "ffmpeg", "ffprobe", "codesign", "pkg-config"]) {
  const res = commandOk(cmd);
  add(`command:${cmd}`, res.ok, res.detail);
}

add("spotify:system-app", existsSync("/Applications/Spotify.app/Contents/MacOS/Spotify"), "/Applications/Spotify.app/Contents/MacOS/Spotify");
add("workspace:patched-app", existsSync(join(root, "workspace/PatchedSpotify.app/Contents/MacOS/Spotify")), join(root, "workspace/PatchedSpotify.app/Contents/MacOS/Spotify"));
add("payload:build-output", existsSync(join(root, "soggfy-macos/build/libsoggfy.dylib")), join(root, "soggfy-macos/build/libsoggfy.dylib"));
add("payload:bundle-copy", existsSync(join(root, "workspace/PatchedSpotify.app/Contents/MacOS/libsoggfy.dylib")), join(root, "workspace/PatchedSpotify.app/Contents/MacOS/libsoggfy.dylib"));
add("payload:cli-source", existsSync(join(root, "soggfy-macos/soggfy-cli.cpp")), join(root, "soggfy-macos/soggfy-cli.cpp"));
add("webapp:package", existsSync(join(root, "webapp/package.json")), join(root, "webapp/package.json"));
add("webapp:node-modules", existsSync(join(root, "webapp/node_modules")), join(root, "webapp/node_modules"));
add("webapp:lib-utils", existsSync(join(root, "webapp/src/lib/utils.ts")), join(root, "webapp/src/lib/utils.ts"));
add("webapp:use-mobile", existsSync(join(root, "webapp/src/hooks/use-mobile.ts")), join(root, "webapp/src/hooks/use-mobile.ts"));
add("downloads:writable", existsSync(join(root, "downloads")) || (() => { try { Bun.write(join(root, "downloads/.doctor"), "ok\n"); return true; } catch { return false; } })(), join(root, "downloads"));
add("config:capture-backend", true, process.env.SOGGFY_CAPTURE_BACKEND || "disabled");

for (let i = 1; i <= Number.parseInt(process.env.SOGGFY_POOL_SIZE || "2", 10); i++) {
  const socket = `/tmp/soggfy_instance_${i}.sock`;
  add(`socket:instance-${i}:clear-or-present`, true, existsSync(socket) ? `${socket} exists` : `${socket} clear`);
}

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const mark = check.ok ? "✓" : "✗";
  console.log(`${mark} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll doctor checks passed.");
