import { signSpotifyBundle, signSpotifyCef } from "./spotify-signing";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { captureTrack } from "./capture";
import { SpotifyInstance, type SpotifyInstanceOptions } from "./instance";
import { SOGGFY_HOME } from "./paths";
import {
  type SpotifyCompatibilityChecks,
  type SpotifyCompatibilityEntry,
  type SpotifyCompatibilityRegistry,
  upsertCompatibilityEntry,
} from "./spotify-compatibility";
import { readSpotifyBundleVersion } from "./spotify-runtime";
import { defaultAudioFixturePath, readAudioFixture, verifyAudioFixture } from "./audio-fixture";
import type { SpotifyHookTargetsCandidate } from "./spotify-hook-discovery";

export const DEFAULT_COMPAT_TRACK_ID = "4PTG3Z6ehGkBFwjybzWkR8";
export const SPOTIFY_COMPATIBILITY_REGISTRY_PATH = resolve(
  import.meta.dir,
  "../../compatibility/spotify-versions.json",
);

const MACOS_UNIX_SOCKET_PATH_MAX_BYTES = 103;

export function assertCompatSocketPath(socketPath: string): void {
  const bytes = Buffer.byteLength(socketPath, "utf8");
  if (bytes > MACOS_UNIX_SOCKET_PATH_MAX_BYTES) {
    throw new Error(
      `Unix socket path is too long (${bytes} bytes; max ${MACOS_UNIX_SOCKET_PATH_MAX_BYTES}): ${socketPath}`,
    );
  }
}

export interface CompatProbeOptions {
  appPath: string;
  trackId: string;
  record: boolean;
  keep: boolean;
  json: boolean;
  fixturePath?: string;
  compatibilityHookTargets?: SpotifyHookTargetsCandidate;
}

export function compatibilityProbeInstanceOptions(
  appPath: string,
  version: string,
  targets?: SpotifyHookTargetsCandidate,
): SpotifyInstanceOptions {
  return {
    appPath,
    enforceSupportedVersion: false,
    ...(targets ? { compatibilityHookTargets: { version, targets } } : {}),
  };
}

export function assertCompatibilityProbeRecordSafety(options: CompatProbeOptions): void {
  if (options.record && options.compatibilityHookTargets) {
    throw new Error("Refusing to record production support from temporary discovered hook targets");
  }
}

export interface CompatibilityProbeResult {
  version: string;
  architecture: "arm64";
  status: "supported" | "failed";
  runDir: string;
  commit: string;
  startedAt: string;
  validatedAt: string;
  checks: Required<SpotifyCompatibilityChecks>;
  failureReason?: string;
}

export interface CompatibilityRunPaths {
  appPath: string;
  savePath: string;
  profileDir: string;
}

const REQUIRED_CHECKS: ReadonlyArray<keyof Required<SpotifyCompatibilityChecks>> = [
  "patching", "signing", "processLaunch", "ipc", "decoderHooks",
  "playback", "capture", "mediaValidation", "audioFixture", "headless",
];

export function createCompatibilityRunPaths(runDir: string): CompatibilityRunPaths {
  return {
    appPath: join(runDir, "PatchedSpotify.app"),
    savePath: join(runDir, "save"),
    profileDir: join(runDir, "profile"),
  };
}

function emptyChecks(): Required<SpotifyCompatibilityChecks> {
  return {
    patching: false,
    signing: false,
    processLaunch: false,
    ipc: false,
    decoderHooks: false,
    playback: false,
    capture: false,
    mediaValidation: false,
    audioFixture: false,
    prefetch: false,
    headless: false,
  };
}

function allChecksPassed(checks: Required<SpotifyCompatibilityChecks>): boolean {
  return REQUIRED_CHECKS.every((name) => checks[name] === true);
}

export function compatibilityEntryFromProbe(
  result: Omit<CompatibilityProbeResult, "status"> | CompatibilityProbeResult,
): SpotifyCompatibilityEntry {
  const status = allChecksPassed(result.checks) ? "supported" : "failed";
  return {
    version: result.version,
    architecture: result.architecture,
    status,
    validatedAt: result.validatedAt,
    commit: result.commit,
    checks: { ...result.checks },
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
  };
}

function runChecked(command: string, args: string[], label: string, cwd?: string): string {
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (${result.exitCode}): ${result.stderr.toString().trim() || result.stdout.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function gitCommit(repoRoot: string): string {
  return runChecked("git", ["rev-parse", "HEAD"], "read git commit", repoRoot);
}

function verifyArm64(appPath: string): void {
  const binaryPath = join(appPath, "Contents/MacOS/Spotify");
  const archs = runChecked("lipo", ["-archs", binaryPath], "inspect Spotify architecture");
  if (!archs.split(/\s+/).includes("arm64")) {
    throw new Error(`Candidate Spotify is not arm64-compatible: ${archs || "unknown architecture"}`);
  }
}

function configureBackgroundOnly(appPath: string): void {
  const plist = join(appPath, "Contents/Info.plist");
  Bun.spawnSync(["/usr/libexec/PlistBuddy", "-c", "Delete :LSUIElement", plist]);
  Bun.spawnSync(["/usr/libexec/PlistBuddy", "-c", "Delete :LSBackgroundOnly", plist]);
  runChecked("/usr/libexec/PlistBuddy", ["-c", "Add :LSBackgroundOnly bool true", plist], "set LSBackgroundOnly");
}

function applyCurrentPatch(sourceApp: string, candidateApp: string, repoRoot: string, checks: Required<SpotifyCompatibilityChecks>): void {
  const payloadRoot = join(repoRoot, "soggfy-macos");
  const cmakeLists = join(payloadRoot, "CMakeLists.txt");
  if (!existsSync(cmakeLists)) {
    throw new Error("Spotify compatibility probing requires a source checkout with soggfy-macos/CMakeLists.txt");
  }

  runChecked("ditto", [sourceApp, candidateApp], "clone candidate Spotify app");
  configureBackgroundOnly(candidateApp);

  runChecked("cmake", ["-S", payloadRoot, "-B", join(payloadRoot, "build")], "configure native payload", repoRoot);
  runChecked("cmake", ["--build", join(payloadRoot, "build")], "build native payload", repoRoot);

  const spotifyBinary = join(candidateApp, "Contents/MacOS/Spotify");
  checks.patching = true;
  const cef = join(candidateApp, "Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework");
  if (existsSync(cef)) signSpotifyCef(candidateApp);
  runChecked("codesign", ["-f", "-s", "-", spotifyBinary], "sign Spotify binary");

  const builtPayload = join(payloadRoot, "build/libsoggfy.dylib");
  const installedPayload = join(candidateApp, "Contents/MacOS/libsoggfy.dylib");
  copyFileSync(builtPayload, installedPayload);
  signSpotifyBundle(candidateApp);
  checks.signing = true;
}

export function isFacelessLaunchInfo(output: string): boolean {
  return output.includes("!cgsConnection");
}

function verifyHeadlessProcess(pid: number): boolean {
  const launchInfo = Bun.spawnSync(["lsappinfo", "info", "-only", "pid", String(pid)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (launchInfo.exitCode !== 0 || !isFacelessLaunchInfo(launchInfo.stdout.toString())) return false;

  const swift = `import CoreGraphics; import Foundation; let pid:Int = ${pid}; let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []).filter { (($0[kCGWindowOwnerPID as String] as? Int) ?? -1) == pid }; print(windows.count)`;
  const windowCheck = Bun.spawnSync(["swift", "-e", swift], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024,
  });
  const windowCount = Number.parseInt(windowCheck.stdout.toString().trim(), 10);
  return windowCheck.exitCode === 0 && windowCount === 0;
}

export function recordCompatibilityProbe(
  result: CompatibilityProbeResult,
  registryPath = SPOTIFY_COMPATIBILITY_REGISTRY_PATH,
): SpotifyCompatibilityRegistry {
  if (!existsSync(registryPath)) {
    throw new Error(`Compatibility registry not found: ${registryPath}`);
  }
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as SpotifyCompatibilityRegistry;
  const updated = upsertCompatibilityEntry(registry, compatibilityEntryFromProbe(result));
  writeFileSync(registryPath, `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

function makeRunDir(version: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(SOGGFY_HOME, "compat", "runs", `${stamp}-${version}-${process.pid}`);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  return runDir;
}

function finalResult(
  base: Omit<CompatibilityProbeResult, "status" | "validatedAt">,
): CompatibilityProbeResult {
  const validatedAt = new Date().toISOString();
  const status = allChecksPassed(base.checks) ? "supported" : "failed";
  return { ...base, status, validatedAt };
}

export async function probeSpotifyCompatibility(
  options: CompatProbeOptions,
): Promise<CompatibilityProbeResult> {
  assertCompatibilityProbeRecordSafety(options);
  const repoRoot = resolve(import.meta.dir, "../..");
  if (!existsSync(options.appPath)) throw new Error(`Spotify app not found: ${options.appPath}`);
  const version = readSpotifyBundleVersion(options.appPath);
  if (!version) throw new Error(`Could not read Spotify version from ${options.appPath}`);
  verifyArm64(options.appPath);

  const runDir = makeRunDir(version);
  const paths = createCompatibilityRunPaths(runDir);
  const socketPath = join(runDir, "ipc.sock");
  const checks = emptyChecks();
  const startedAt = new Date().toISOString();
  const commit = gitCommit(repoRoot);
  let instance: SpotifyInstance | null = null;
  let result: CompatibilityProbeResult | null = null;

  try {
    assertCompatSocketPath(socketPath);
    applyCurrentPatch(options.appPath, paths.appPath, repoRoot, checks);
    instance = new SpotifyInstance(
      socketPath,
      paths.savePath,
      paths.profileDir,
      compatibilityProbeInstanceOptions(paths.appPath, version, options.compatibilityHookTargets),
    );
    await instance.start();
    checks.processLaunch = instance.pid !== null;
    checks.ipc = (await instance.sendCommand("ping")) === "pong";

    const capabilities = JSON.parse(await instance.sendCommand("get_capabilities")) as {
      hooksInitialized?: boolean;
      decoderHooksReady?: boolean;
      captureBackend?: string;
    };
    checks.decoderHooks = capabilities.hooksInitialized === true
      && capabilities.decoderHooksReady === true
      && capabilities.captureBackend === "ogg";
    if (!checks.decoderHooks) {
      throw new Error(`Native capture hooks are not compatible: ${JSON.stringify(capabilities)}`);
    }

    if (!instance.pid) throw new Error("Candidate Spotify process did not report a PID");
    checks.headless = verifyHeadlessProcess(instance.pid);
    if (!checks.headless) throw new Error("Candidate Spotify exposed a visible GUI/window registration");

    const capture = await captureTrack(socketPath, paths.savePath, options.trackId, {
      playbackAttempts: 20,
      playbackDelayMs: 500,
    });
    // captureTrack only returns after exact target playback was confirmed and
    // the complete captured file passed media validation. One run therefore
    // proves playback + capture without a pause/restart preflight cycle.
    checks.playback = true;
    checks.capture = capture.bytesWritten > 0;
    checks.mediaValidation = true;

    const fixturePath = options.fixturePath ?? defaultAudioFixturePath(options.trackId);
    const fixture = readAudioFixture(fixturePath);
    if (fixture.trackId !== options.trackId) {
      throw new Error(`Audio fixture track mismatch: expected ${options.trackId}, manifest is ${fixture.trackId}`);
    }
    const fixtureVerification = verifyAudioFixture(capture.wavPath, fixture);
    checks.audioFixture = fixtureVerification.ok;
    if (!fixtureVerification.ok) {
      throw new Error(
        `Whole-track audio fixture mismatch: exactFile=${fixtureVerification.exactFileMatch} `
        + `decodedPcm=${fixtureVerification.decodedPcmMatch} fixture=${fixturePath}`,
      );
    }

    result = finalResult({
      version,
      architecture: "arm64",
      runDir,
      commit,
      startedAt,
      checks,
    });

  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    result = finalResult({
      version,
      architecture: "arm64",
      runDir,
      commit,
      startedAt,
      checks,
      failureReason,
    });
  } finally {
    if (instance) await instance.stop().catch(() => undefined);
    try { if (existsSync(socketPath)) rmSync(socketPath, { force: true }); } catch {}
  }

  if (!result) throw new Error("Compatibility probe did not produce a result");
  if (options.record) recordCompatibilityProbe(result);
  if (!options.keep) rmSync(runDir, { recursive: true, force: true });
  return result;
}
