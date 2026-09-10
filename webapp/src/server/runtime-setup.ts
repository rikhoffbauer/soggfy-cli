import { signSpotifyBundle } from "../../../src/core/spotify-signing";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { assertSupportedSpotifyBundle } from "../../../src/core/spotify-runtime";
import { WORKSPACE_DIR } from "../../../src/core/paths";
import { REPO_ROOT } from "./runtime-config";

function runChecked(command: string, args: string[], label: string): void {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr || result.stdout || "no output"}`);
  }
}

export async function preparePayload(): Promise<void> {
  const dylibSource = join(REPO_ROOT, "soggfy-macos/build/libsoggfy.dylib");
  const appBundle = join(WORKSPACE_DIR, "PatchedSpotify.app");
  const destDir = join(appBundle, "Contents/MacOS");
  const dylibDest = join(destDir, "libsoggfy.dylib");
  if (!existsSync(dylibSource)) {
    throw new Error(`[Server] libsoggfy.dylib not found at ${dylibSource}. Build the native payload first.`);
  }
  assertSupportedSpotifyBundle(appBundle);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(dylibSource, dylibDest);
  signSpotifyBundle(appBundle);
}
