import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { readSpotifyBundleVersion } from "./spotify-runtime";

export type SpotifyCefSigningStrategy = "replace-existing" | "remove-then-sign";

export function spotifyCefSigningStrategy(version: string | null): SpotifyCefSigningStrategy {
  return version === "1.3.0.277" ? "remove-then-sign" : "replace-existing";
}

function codesign(args: string[]): void {
  const result = Bun.spawnSync(["/usr/bin/codesign", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`Spotify signing failed: ${result.stderr.toString().trim()}`);
}

export function shouldRetrySpotifyCefSigning(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("replacing existing signature")
    && message.includes("internal error in Code Signing subsystem");
}

export function signSpotifyCef(app: string): void {
  const cef = join(app, "Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework");
  if (!existsSync(cef)) throw new Error(`Spotify CEF binary is missing: ${cef}`);
  const strategy = spotifyCefSigningStrategy(readSpotifyBundleVersion(app));
  if (strategy === "remove-then-sign") {
    codesign(["--remove-signature", cef]);
    codesign(["-f", "-s", "-", cef]);
    return;
  }
  try {
    codesign(["-f", "-s", "-", cef]);
  } catch (error) {
    if (!shouldRetrySpotifyCefSigning(error)) throw error;
    codesign(["--remove-signature", cef]);
    codesign(["-f", "-s", "-", cef]);
  }
}

export function assertSignedSpotifyCli(app: string): void {
  const cli = join(app, "Contents/MacOS/spotify_cli");
  if (!existsSync(cli)) throw new Error("Spotify CLI is missing. Reinstall the patched app from an official Spotify bundle.");
  codesign(["--verify", "--strict", "-R", '=anchor apple generic and certificate leaf[subject.OU] = "2FNC3A47ZF"', cli]);
}

// Preserve Spotify's signature on spotify_cli: its local playback API verifies
// the caller. Recursive ad-hoc signing destroys that authentication identity.
export function signSpotifyBundle(app: string): void {
  assertSignedSpotifyCli(app);
  const frameworks = join(app, "Contents/Frameworks");
  signSpotifyCef(app);
  for (const name of readdirSync(frameworks)) {
    if (name.startsWith("Spotify Helper") && name.endsWith(".app")) {
      codesign(["-f", "-s", "-", join(frameworks, name)]);
    }
  }
  codesign(["-f", "-s", "-", join(app, "Contents/MacOS/libsoggfy.dylib")]);
  codesign(["-f", "-s", "-", app]);
  codesign(["--verify", "--deep", "--strict", app]);
  assertSignedSpotifyCli(app);
}
