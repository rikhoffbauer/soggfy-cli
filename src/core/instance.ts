import { spawn, type Subprocess } from "bun";
import { existsSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { sendIPC, ping } from "./ipc";
import { log } from "./log";
import { assertSupportedSpotifyBundle, cloneSpotifyLoginState, terminateProcessTree } from "./spotify-runtime";
import { migrateOfficialSpotifyAuthOnce } from "./auth-migration";
import {
  PATCHED_APP,
  PROFILES_DIR,
  IPC_SOCKET,
  SAVE_PATH,
  CAPTURE_BACKEND,
} from "./paths";

export interface SpotifyInstanceOptions {
  appPath?: string;
  enforceSupportedVersion?: boolean;
}

export class SpotifyInstance {
  process: Subprocess | null = null;
  socketPath: string;
  savePath: string;
  profileDir: string;
  appPath: string;
  enforceSupportedVersion: boolean;
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

    // Prepare directories
    mkdirSync(this.savePath, { recursive: true, mode: 0o700 });
    mkdirSync(this.profileDir, { recursive: true, mode: 0o700 });
    const homeDir = join(this.profileDir, "home");
    mkdirSync(homeDir, { recursive: true, mode: 0o700 });

    const appSupportDest = join(this.savePath, "Application Support/Spotify");
    try {
      const migration = migrateOfficialSpotifyAuthOnce();
      if (migration === "migrated") log.info("Migrated existing Spotify login state into Soggfy-owned auth state.");
    } catch (error) {
      log.warn(`Could not migrate existing Spotify login state: ${error instanceof Error ? error.message : String(error)}`);
    }
    const loginState = cloneSpotifyLoginState(appSupportDest);
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
      ...(sslKeyLogPath ? { SSLKEYLOGFILE: sslKeyLogPath } : {}),
    };

    const cefFlags = [
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--renderer-process-limit=1",
      "--js-flags=--max-old-space-size=256",
      "--disable-extensions",
      "--disable-background-networking",
      `--cache-path=${this.profileDir}`,
      `--user-data-dir=${this.profileDir}`,
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
