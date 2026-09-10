import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { log } from "../core/log";
import { assertSupportedSpotifyBundle } from "../core/spotify-runtime";
import { replaceDirectoryAtomically } from "../core/atomic-directory";
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

  // Steps 3-6 are transactional: build and verify a staged app before replacing the current workspace.
  const stagedApp = join(WORKSPACE_DIR, `.PatchedSpotify.app.staging-${process.pid}`);
  rmSync(stagedApp, { recursive: true, force: true });
  mkdirSync(WORKSPACE_DIR, { recursive: true });

  try {
    log.step(3, totalSteps, "Creating staged patched workspace app");
    log.info("Cloning Spotify.app into staging...");
    run(["ditto", SPOTIFY_APP, stagedApp], "ditto copy Spotify.app");

    const infoPlist = join(stagedApp, "Contents/Info.plist");
    Bun.spawnSync(["/usr/libexec/PlistBuddy", "-c", "Delete :LSUIElement", infoPlist], {
      stdout: "ignore",
      stderr: "ignore",
    });
    Bun.spawnSync(["/usr/libexec/PlistBuddy", "-c", "Delete :LSBackgroundOnly", infoPlist], {
      stdout: "ignore",
      stderr: "ignore",
    });
    run(
      ["/usr/libexec/PlistBuddy", "-c", "Add :LSBackgroundOnly bool true", infoPlist],
      "configure patched Spotify as background-only",
    );

    log.step(4, totalSteps, "Stripping signatures and ad-hoc signing");
    const signTargets = [
      join(stagedApp, "Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework"),
      join(stagedApp, "Contents/MacOS/Spotify"),
    ];
    for (const target of signTargets) {
      if (existsSync(target)) {
        run(["codesign", "-f", "-s", "-", target], `codesign ${target}`);
        log.ok(`Signed: ${target.split("/").pop()}`);
      } else {
        log.warn(`Signature target missing: ${target}`);
      }
    }

    log.step(5, totalSteps, "Building payload (libsoggfy.dylib)");
    const repoPayloadDir = join(import.meta.dir, "..", "..", "soggfy-macos");
    const bundledPrebuiltDylib = join(import.meta.dir, "..", "payload", "libsoggfy.dylib");
    const hasPayloadSource = existsSync(join(repoPayloadDir, "CMakeLists.txt"));
    let dylibPath = "";

    if (!hasPayloadSource && !rebuild && existsSync(bundledPrebuiltDylib)) {
      log.ok("Using bundled prebuilt payload (libsoggfy.dylib)");
      dylibPath = bundledPrebuiltDylib;
    } else {
      let payloadSourceDir = PAYLOAD_SOURCE_DIR;
      if (hasPayloadSource) {
        payloadSourceDir = repoPayloadDir;
      } else if (!existsSync(PAYLOAD_SOURCE_DIR)) {
        throw new Error("Payload source not found. Cannot build libsoggfy.dylib.");
      }

      const buildDir = join(payloadSourceDir, "build");
      if (rebuild && existsSync(buildDir)) rmSync(buildDir, { recursive: true, force: true });
      log.info("Running cmake...");
      run(["cmake", "-S", ".", "-B", "build"], "cmake configure", { cwd: payloadSourceDir });
      log.info("Building...");
      run(["cmake", "--build", "build"], "cmake build", { cwd: payloadSourceDir });
      dylibPath = join(buildDir, "libsoggfy.dylib");
      if (!existsSync(dylibPath)) {
        throw new Error("Build succeeded but libsoggfy.dylib not found.");
      }
    }

    log.step(6, totalSteps, "Installing payload into staged app");
    const destDir = join(stagedApp, "Contents/MacOS");
    mkdirSync(destDir, { recursive: true });
    const destDylib = join(destDir, "libsoggfy.dylib");
    run(["cp", dylibPath, destDylib], "copy dylib");
    run(["codesign", "-f", "-s", "-", destDylib], "sign dylib");
    run(["codesign", "-f", "-s", "-", "--deep", stagedApp], "sign patched Spotify bundle");
    run(["codesign", "--verify", "--deep", "--strict", stagedApp], "verify patched Spotify bundle");
    log.ok("Staged payload installed, signed, and verified");

    replaceDirectoryAtomically(stagedApp, PATCHED_APP);
  } finally {
    rmSync(stagedApp, { recursive: true, force: true });
  }

  log.header("Installation Complete");
  log.ok("Patched app ready at: " + PATCHED_APP);
  log.info("Next steps:");
  log.info("  1. soggfy auth login    # authenticate with Spotify");
  log.info("  2. soggfy daemon start  # start background instance");
  log.info("  3. soggfy download <track> > output.mp3");
}
