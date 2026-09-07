import { spawn, type Subprocess } from "bun";
import { existsSync, unlinkSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { sendIPC, ping } from "./ipc";
import { log } from "./log";
import {
  PATCHED_APP,
  PROFILES_DIR,
  IPC_SOCKET,
  SAVE_PATH,
  CAPTURE_BACKEND,
} from "./paths";

export class SpotifyInstance {
  process: Subprocess | null = null;
  socketPath: string;
  savePath: string;
  profileDir: string;
  isReady = false;

  constructor(
    socketPath = IPC_SOCKET,
    savePath = SAVE_PATH,
    profileDir?: string,
  ) {
    this.socketPath = socketPath;
    this.savePath = savePath;
    this.profileDir =
      profileDir ||
      (savePath === SAVE_PATH
        ? join(PROFILES_DIR, "cli_instance")
        : join(savePath, "profile"));
  }

  async start(): Promise<void> {
    log.info("Starting patched Spotify instance...");

    const binaryPath = join(PATCHED_APP, "Contents/MacOS/Spotify");
    const dylibPath = join(PATCHED_APP, "Contents/MacOS/libsoggfy.dylib");

    if (!existsSync(binaryPath)) {
      throw new Error(`Patched Spotify binary not found: ${binaryPath}. Run 'soggfy install' first.`);
    }
    if (!existsSync(dylibPath)) {
      throw new Error(`Payload dylib not found: ${dylibPath}. Run 'soggfy install' first.`);
    }

    // Prepare directories
    mkdirSync(this.savePath, { recursive: true });
    mkdirSync(this.profileDir, { recursive: true });
    const homeDir = join(this.profileDir, "home");
    mkdirSync(homeDir, { recursive: true });

    // Clone login state from system Spotify
    const appSupportDest = join(this.savePath, "Application Support/Spotify");
    mkdirSync(appSupportDest, { recursive: true });
    const sourceDir = join(homedir(), "Library/Application Support/Spotify");
    try {
      const prefsPath = join(sourceDir, "prefs");
      if (existsSync(prefsPath)) copyFileSync(prefsPath, join(appSupportDest, "prefs"));

      const usersPath = join(sourceDir, "Users");
      if (existsSync(usersPath)) {
        await spawn(["cp", "-R", usersPath, appSupportDest]).exited;
      }

      const cachePath = join(sourceDir, "PersistentCache");
      if (existsSync(cachePath)) {
        await spawn(["cp", "-R", cachePath, appSupportDest]).exited;
      }
    } catch (e: any) {
      log.warn(`Could not clone login state: ${e.message}`);
    }

    // Clean stale socket and locks
    try { if (existsSync(this.socketPath)) unlinkSync(this.socketPath); } catch {}
    for (const lf of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try { const p = join(this.profileDir, lf); if (existsSync(p)) unlinkSync(p); } catch {}
    }

    const sslKeyLogPath = process.env.SSLKEYLOGFILE || "/tmp/sslkeylog.log";

    const tmpDir = join(this.profileDir, "tmp");
    mkdirSync(tmpDir, { recursive: true });

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
      SSLKEYLOGFILE: sslKeyLogPath,
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
      `--ssl-key-log-file=${sslKeyLogPath}`,
    ];


    this.process = spawn([binaryPath, ...cefFlags], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });



    log.info(`Spotify process spawned (PID: ${this.process.pid})`);

    // Wait for IPC socket readiness
    const ready = await this.waitForSocket();
    if (!ready) {
      throw new Error("IPC socket/hook handshake timed out. Spotify may have failed to start.");
    }

    this.isReady = true;
    log.ok("Spotify instance ready.");
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
      try {
        this.process.kill("SIGKILL");
        await Promise.race([
          this.process.exited,
          Bun.sleep(2000),
        ]);
      } catch {}
      this.process = null;
    }
    // Cleanup
    try { Bun.spawnSync(["pkill", "-9", "-f", "SOGGFY_SOCKET_PATH=" + this.socketPath]); } catch {}
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
