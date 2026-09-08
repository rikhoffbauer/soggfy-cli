import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { log } from "../core/log";
import { assertSupportedSpotifyBundle } from "../core/spotify-runtime";
import {
  SOGGFY_HOME,
  WORKSPACE_DIR,
  PATCHED_APP,
  SPOTIFY_APP,
  SPOTIFY_INSTALLER_URL,
  ensureDirs,
} from "../core/paths";

const PAYLOAD_SOURCE_DIR = join(SOGGFY_HOME, "payload", "soggfy-macos");

function run(cmd: string[], label: string, opts: { cwd?: string } = {}): void {
  const result = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    throw new Error(`${label} failed (exit ${result.exitCode}): ${stderr || "no output"}`);
  }
}

function commandExists(cmd: string): boolean {
  const result = Bun.spawnSync(["which", cmd], { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0;
}

function brewInstalled(pkg: string): boolean {
  const result = Bun.spawnSync(["brew", "list", pkg], { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0;
}

export async function installCommand(args: string[]): Promise<void> {
  const skipSpotifyInstall = args.includes("--skip-spotify-install");
  const rebuild = args.includes("--rebuild");
  const totalSteps = 6;

  log.header("Soggfy CLI Install");
  ensureDirs();

  // Step 1: Check dependencies
  log.step(1, totalSteps, "Checking dependencies");

  if (!commandExists("brew")) {
    log.error("Homebrew is required. Install from https://brew.sh/");
    process.exit(1);
  }

  const deps = ["cmake", "ffmpeg", "chromaprint"];
  for (const dep of deps) {
    if (!brewInstalled(dep) && !commandExists(dep)) {
      log.info(`Installing ${dep} via Homebrew...`);
      run(["brew", "install", dep], `brew install ${dep}`);
    }
    log.ok(dep);
  }

  if (!commandExists("codesign")) {
    log.error("codesign not found. Xcode Command Line Tools required.");
    process.exit(1);
  }
  log.ok("codesign");

  // Step 2: Check Spotify.app
  log.step(2, totalSteps, "Checking Spotify.app");

  if (!existsSync(SPOTIFY_APP)) {
    if (skipSpotifyInstall) {
      log.error("/Applications/Spotify.app is missing and --skip-spotify-install was provided.");
      process.exit(1);
    }

    log.info("Spotify.app not found. Downloading and installing...");
    const tmpDir = "/tmp/SoggfySpotifyInstaller";
    Bun.spawnSync(["rm", "-rf", tmpDir]);
    mkdirSync(tmpDir, { recursive: true });

    log.info("Downloading Spotify installer...");
    const zipPath = join(tmpDir, "SpotifyInstaller.zip");
    const response = await fetch(SPOTIFY_INSTALLER_URL);
    if (!response.ok) throw new Error(`Failed to download Spotify: ${response.status}`);
    await Bun.write(zipPath, response);

    log.info("Extracting installer...");
    run(["unzip", "-oq", zipPath, "-d", tmpDir], "unzip Spotify installer");

    log.info("Running Spotify installer...");
    Bun.spawnSync(["open", join(tmpDir, "Install Spotify.app")]);

    log.info("Waiting for /Applications/Spotify.app to appear...");
    for (let i = 0; i < 120; i++) {
      if (existsSync(SPOTIFY_APP)) break;
      await Bun.sleep(2000);
    }
    if (!existsSync(SPOTIFY_APP)) {
      log.error("Spotify installation timed out.");
      process.exit(1);
    }
  }
  log.ok("Spotify.app present");
  try {
    assertSupportedSpotifyBundle(SPOTIFY_APP);
    log.ok("Spotify build is capture-compatible");
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Step 3: Create patched workspace
  log.step(3, totalSteps, "Creating patched workspace app");

  if (existsSync(PATCHED_APP)) {
    Bun.spawnSync(["rm", "-rf", PATCHED_APP]);
  }
  mkdirSync(WORKSPACE_DIR, { recursive: true });

  log.info("Cloning Spotify.app...");
  run(["ditto", SPOTIFY_APP, PATCHED_APP], "ditto copy Spotify.app");

  // Step 4: Strip and re-sign
  log.step(4, totalSteps, "Stripping signatures and ad-hoc signing");

  const signTargets = [
    join(PATCHED_APP, "Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework"),
    join(PATCHED_APP, "Contents/MacOS/Spotify"),
  ];

  for (const target of signTargets) {
    if (existsSync(target)) {
      run(["codesign", "-f", "-s", "-", target], `codesign ${target}`);
      log.ok(`Signed: ${target.split("/").pop()}`);
    } else {
      log.warn(`Signature target missing: ${target}`);
    }
  }

  // Step 5: Build payload
  log.step(5, totalSteps, "Building payload (libsoggfy.dylib)");

  const repoPayloadDir = join(import.meta.dir, "..", "..", "soggfy-macos");
  const prebuiltDylib = join(import.meta.dir, "..", "payload", "libsoggfy.dylib");

  let dylibPath = "";

  if (!rebuild && existsSync(prebuiltDylib)) {
    log.ok("Using bundled prebuilt payload (libsoggfy.dylib)");
    dylibPath = prebuiltDylib;
  } else {
    let payloadSourceDir = PAYLOAD_SOURCE_DIR;
    if (existsSync(join(repoPayloadDir, "CMakeLists.txt"))) {
      payloadSourceDir = repoPayloadDir;
    } else if (!existsSync(PAYLOAD_SOURCE_DIR)) {
      log.error("Payload source not found. Cannot build libsoggfy.dylib.");
      process.exit(1);
    }

    const buildDir = join(payloadSourceDir, "build");
    if (rebuild && existsSync(buildDir)) {
      Bun.spawnSync(["rm", "-rf", buildDir]);
    }

    log.info("Running cmake...");
    run(["cmake", "-S", ".", "-B", "build"], "cmake configure", { cwd: payloadSourceDir });

    log.info("Building...");
    run(["cmake", "--build", "build"], "cmake build", { cwd: payloadSourceDir });

    dylibPath = join(buildDir, "libsoggfy.dylib");
    if (!existsSync(dylibPath)) {
      log.error("Build succeeded but libsoggfy.dylib not found.");
      process.exit(1);
    }
  }

  // Step 6: Copy payload into patched app
  log.step(6, totalSteps, "Installing payload into patched app");

  const destDir = join(PATCHED_APP, "Contents/MacOS");
  mkdirSync(destDir, { recursive: true });
  const destDylib = join(destDir, "libsoggfy.dylib");
  run(["cp", dylibPath, destDylib], "copy dylib");
  run(["codesign", "-f", "-s", "-", destDylib], "sign dylib");
  run(["codesign", "-f", "-s", "-", "--deep", PATCHED_APP], "sign patched Spotify bundle");
  run(["codesign", "--verify", "--deep", "--strict", PATCHED_APP], "verify patched Spotify bundle");
  log.ok("Payload installed, signed, and verified");

  log.header("Installation Complete");
  log.ok("Patched app ready at: " + PATCHED_APP);
  log.info("Next steps:");
  log.info("  1. soggfy auth login    # authenticate with Spotify");
  log.info("  2. soggfy daemon start  # start background instance");
  log.info("  3. soggfy stream <track> > output.mp3");
}
