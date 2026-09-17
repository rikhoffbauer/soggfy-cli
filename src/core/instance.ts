import { spawn, type Subprocess } from "bun";
import { existsSync, unlinkSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { sendIPC, ping } from "./ipc";
import { log } from "./log";
import { assertSupportedSpotifyBundle, cloneSpotifyLoginState, resetSpotifyTransientRuntimeState, terminateProcessTree } from "./spotify-runtime";
import { migrateOfficialSpotifyAuthOnce } from "./auth-migration";
import { inspectOrphanSpotifyOwner, retireOrphanSpotifyOwner } from "./daemon-owner";
import { compatibilityHookTargetEnvironment, type SpotifyHookTargetsCandidate } from "./spotify-hook-discovery";
import {
  PATCHED_APP,
  PROFILES_DIR,
  IPC_SOCKET,
  SAVE_PATH,
  CAPTURE_BACKEND,
  AUTH_STATE_DIR,
} from "./paths";

export interface SpotifyCompatibilityHookTargetOptions {
  version: string;
  targets: SpotifyHookTargetsCandidate;
}

export interface SpotifyInstanceOptions {
  appPath?: string;
  enforceSupportedVersion?: boolean;
  debugPort?: number;
  compatibilityHookTargets?: SpotifyCompatibilityHookTargetOptions;
}

export function managedStandaloneProfileDirs(profilesDir = PROFILES_DIR): string[] {
  try {
    return readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^instance_\d+$/.test(entry.name))
      .map((entry) => join(profilesDir, entry.name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

export function spotifyInstanceCompatibilityEnvironment(
  compatibilityHookTargets?: SpotifyCompatibilityHookTargetOptions,
): Record<string, string> {
  return compatibilityHookTargets
    ? compatibilityHookTargetEnvironment(compatibilityHookTargets.version, compatibilityHookTargets.targets)
    : { SOGGFY_COMPAT_ALLOW_DISCOVERED_TARGETS: "0" };
}

export class SpotifyInstance {
  process: Subprocess | null = null;
  socketPath: string;
  savePath: string;
  profileDir: string;
  appPath: string;
  enforceSupportedVersion: boolean;
  debugPort?: number;
  compatibilityHookTargets?: SpotifyCompatibilityHookTargetOptions;
  isReady = false;

  constructor(
    socketPath = IPC_SOCKET,
    savePath = SAVE_PATH,
    profileDir?: string,
    options: SpotifyInstanceOptions = {},
  ) {
    this.socketPath = socketPath;
    this.savePath = savePath;
    this.profileDir = profileDir || join(PROFILES_DIR, "cli_instance");
    this.appPath = options.appPath ?? PATCHED_APP;
    this.enforceSupportedVersion = options.enforceSupportedVersion !== false;
    this.debugPort = options.debugPort;
    this.compatibilityHookTargets = options.compatibilityHookTargets;
  }

  async start(): Promise<void> {
    log.info("Starting patched Spotify instance...");

    const binaryPath = join(this.appPath, "Contents/MacOS/Spotify");
    const dylibPath = join(this.appPath, "Contents/MacOS/libsoggfy.dylib");

    if (!existsSync(binaryPath)) {
      throw new Error(`Patched Spotify binary not found: ${binaryPath}. Run 'soggfy install' first.`);
    }
    if (!existsSync(dylibPath)) {
      throw new Error(`Payload dylib not found: ${dylibPath}. Run 'soggfy install' first.`);
    }
    if (this.enforceSupportedVersion) assertSupportedSpotifyBundle(this.appPath);

    await this.retireOrphanedProfile(binaryPath, this.profileDir, "Soggfy profile");

    const daemonProfileDir = join(PROFILES_DIR, "cli_instance");
    if (this.profileDir === daemonProfileDir) {
      for (const standaloneProfileDir of managedStandaloneProfileDirs()) {
        if (standaloneProfileDir === this.profileDir) continue;
        await this.retireOrphanedProfile(binaryPath, standaloneProfileDir, "standalone web runtime profile");
      }
    }

    // Prepare directories
    mkdirSync(this.savePath, { recursive: true, mode: 0o700 });
    mkdirSync(this.profileDir, { recursive: true, mode: 0o700 });
    resetSpotifyTransientRuntimeState(this.savePath);
    const homeDir = join(this.profileDir, "home");
    mkdirSync(homeDir, { recursive: true, mode: 0o700 });

    const appSupportDest = join(this.savePath, "Application Support/Spotify");
    try {
      const migration = migrateOfficialSpotifyAuthOnce();
      if (migration === "migrated") log.info("Migrated existing Spotify login state into Soggfy-owned auth state.");
      else if (migration === "upgraded") log.info("Upgraded Soggfy Spotify login state with required WebKit session data.");
    } catch (error) {
      log.warn(`Could not migrate existing Spotify login state: ${error instanceof Error ? error.message : String(error)}`);
    }
    const loginState = cloneSpotifyLoginState(appSupportDest, AUTH_STATE_DIR, {
      webKitDest: join(homeDir, "Library/WebKit/com.spotify.client"),
    });
    if (!loginState.copiedPrefs && !loginState.copiedSessionCache) {
      log.warn("No reusable Spotify login state found; run 'soggfy auth login'.");
    }

    // Clean stale socket and locks
    try { if (existsSync(this.socketPath)) unlinkSync(this.socketPath); } catch {}
    for (const lf of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try { const p = join(this.profileDir, lf); if (existsSync(p)) unlinkSync(p); } catch {}
    }

    const sslKeyLogPath = process.env.SOGGFY_SSL_KEYLOG_FILE;

    const tmpDir = join(this.profileDir, "tmp");
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      HOME: homeDir,
      TMPDIR: tmpDir,
      DYLD_INSERT_LIBRARIES: dylibPath,
      SOGGFY_SOCKET_PATH: this.socketPath,
      SOGGFY_SAVE_PATH: this.savePath,
      SOGGFY_NO_FOCUS: "1",
      SOGGFY_HIDDEN: "1",
      SOGGFY_CAPTURE_BACKEND: CAPTURE_BACKEND,
      SOGGFY_MUTE_OUTPUT: "1",
      ...spotifyInstanceCompatibilityEnvironment(this.compatibilityHookTargets),
      ...(sslKeyLogPath ? { SSLKEYLOGFILE: sslKeyLogPath } : {}),
    };

    const cefFlags = [
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--renderer-process-limit=1",
      "--js-flags=--max-old-space-size=256",
      "--disable-extensions",
      "--disable-background-networking",
      `--user-data-dir=${this.profileDir}`,
      ...(this.debugPort ? [`--remote-debugging-port=${this.debugPort}`] : []),
      ...(sslKeyLogPath ? [`--ssl-key-log-file=${sslKeyLogPath}`] : []),
    ];


    this.process = spawn([binaryPath, ...cefFlags], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    this.pipeProcessLogs();

    log.info(`Spotify process spawned (PID: ${this.process.pid})`);

    // Wait for IPC socket readiness
    const ready = await this.waitForSocket();
    if (!ready) {
      await this.stop();
      throw new Error("IPC socket/hook handshake timed out. Spotify may have failed to start.");
    }

    this.isReady = true;
    log.ok("Spotify instance ready.");
  }

  private async retireOrphanedProfile(binaryPath: string, profileDir: string, label: string): Promise<void> {
    const orphanInspection = inspectOrphanSpotifyOwner(binaryPath, profileDir);
    if (orphanInspection.kind === "unavailable") {
      throw new Error(
        `Soggfy cannot inspect running Spotify processes; refusing to launch while checking ${label} ${profileDir}.`,
      );
    }
    if (orphanInspection.kind === "verified") {
      const orphan = orphanInspection.owner;
      log.warn(`Retiring orphaned ${label} Spotify process ${orphan.spotifyPid} before replacement launch.`);
      await retireOrphanSpotifyOwner(orphan);
      return;
    }
    if (orphanInspection.kind === "unverifiable") {
      throw new Error(
        `Spotify process ${orphanInspection.spotifyPid} already uses ${label} ${profileDir}, `
        + "but Soggfy cannot verify or terminate it safely. If it was started with sudo/root, "
        + `stop it with 'sudo kill ${orphanInspection.spotifyPid}' and retry.`,
      );
    }
  }

  private pipeProcessLogs(): void {
    if (!this.process) return;
    const stdout = (this.process as any).stdout;
    const stderr = (this.process as any).stderr;
    const logWriter = Bun.file(join(this.profileDir, "spotify.log")).writer();
    const errWriter = Bun.file(join(this.profileDir, "spotify.err")).writer();
    const pump = async (stream: AsyncIterable<Uint8Array>, writer: any) => {
      try {
        for await (const chunk of stream) {
          writer.write(chunk);
          writer.flush();
        }
      } catch {} finally {
        writer.end();
      }
    };
    void pump(stdout, logWriter);
    void pump(stderr, errWriter);
  }

  private async waitForSocket(): Promise<boolean> {
    for (let i = 0; i < 60; i++) {
      if (this.process) {
        try {
          process.kill(this.process.pid, 0);
        } catch {
          // Process exited
          return false;
        }
      }
      if (existsSync(this.socketPath)) {
        const ok = await ping(this.socketPath);
        if (ok) return true;
      }
      await Bun.sleep(500);
    }
    return false;
  }

  async stop(): Promise<void> {
    this.isReady = false;
    if (this.process) {
      const pid = this.process.pid;
      await terminateProcessTree(pid, this.process.exited);
      this.process = null;
    }
    try { if (existsSync(this.socketPath)) unlinkSync(this.socketPath); } catch {}
    log.info("Spotify instance stopped.");
  }

  async sendCommand(command: string): Promise<string> {
    if (!this.isReady) throw new Error("Instance not ready");
    return sendIPC(this.socketPath, command);
  }

  get pid(): number | null {
    return this.process?.pid ?? null;
  }
}
