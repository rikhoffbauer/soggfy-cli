import { existsSync, readdirSync } from "fs";
import { join } from "path";

function codesign(args: string[]): void {
  const result = Bun.spawnSync(["/usr/bin/codesign", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`Spotify signing failed: ${result.stderr.toString().trim()}`);
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
  const cef = join(frameworks, "Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework");
  codesign(["-f", "-s", "-", cef]);
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
