import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { spawn } from "child_process";
import { log } from "../core/log";
import { PID_FILE, DAEMON_LOG, IPC_SOCKET, SAVE_PATH, ensureDirs } from "../core/paths";
import { SpotifyInstance } from "../core/instance";
import { ping } from "../core/ipc";

export async function daemonCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    console.error(`
Usage: soggfy daemon <subcommand>

Subcommands:
  start     Start the daemon in the background
  stop      Stop the daemon
  restart   Restart the daemon
  status    Show daemon status
  logs      Tail daemon logs
  run       Run daemon in foreground (internal)
`);
    return;
  }

  switch (sub) {
    case "start":
      return daemonStart();
    case "stop":
      return daemonStop();
    case "restart":
      await daemonStop();
      await Bun.sleep(1000);
      return daemonStart();
    case "status":
      return daemonStatus();
    case "logs":
      return daemonLogs();
    case "run":
      return daemonRun();
    default:
      throw new Error(`Unknown daemon subcommand: ${sub}`);
  }
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number.parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    try { unlinkSync(PID_FILE); } catch {}
    return null;
  }
}

function isAlive(): boolean {
  return readPid() !== null;
}

function spawnDaemonProcess(): number {
  const cliEntry = process.argv[1];
  if (!cliEntry) throw new Error("Cannot determine current CLI entrypoint");

  const logFd = openSync(DAEMON_LOG, "a", 0o600);
  chmodSync(DAEMON_LOG, 0o600);
  try {
    const child = spawn(process.execPath, [cliEntry, "daemon", "run"], {
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    if (!child.pid) throw new Error("Daemon subprocess did not report a PID");
    return child.pid;
  } finally {
    closeSync(logFd);
  }
}

async function daemonStart(): Promise<void> {
  log.header("Starting Daemon");
  if (isAlive()) {
    log.info(`Daemon already running (PID: ${readPid()})`);
    return;
  }

  ensureDirs();
  const daemonPid = spawnDaemonProcess();
  log.ok(`Daemon started (PID: ${daemonPid})`);

  log.info("Waiting for Spotify instance to become ready...");
  for (let i = 0; i < 90; i++) {
    await Bun.sleep(1000);
    try {
      process.kill(daemonPid, 0);
    } catch {
      throw new Error("Daemon process exited unexpectedly. Check: soggfy daemon logs");
    }

    if (await ping(IPC_SOCKET)) {
      log.ok("Spotify instance ready.");
      return;
    }
  }

  try { process.kill(daemonPid, "SIGTERM"); } catch {}
  throw new Error("Spotify instance did not become ready within 90 seconds. Check: soggfy daemon logs");
}

async function daemonStop(): Promise<void> {
  log.header("Stopping Daemon");
  const pid = readPid();
  if (!pid) {
    log.info("Daemon is not running.");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(250);
      try { process.kill(pid, 0); } catch { break; }
    }
    try { process.kill(pid, "SIGKILL"); } catch {}
  } finally {
    try { unlinkSync(PID_FILE); } catch {}
  }

  log.ok(`Daemon stopped (was PID: ${pid})`);
}

async function daemonStatus(): Promise<void> {
  log.header("Daemon Status");
  const pid = readPid();
  if (!pid) {
    log.info("Daemon is not running.");
    return;
  }

  log.ok(`Daemon running (PID: ${pid})`);
  const ipcAlive = await ping(IPC_SOCKET);
  if (ipcAlive) log.ok("Spotify IPC: responsive");
  else log.warn("Spotify IPC: not responding");

  log.dim(`  PID file: ${PID_FILE}`);
  log.dim(`  IPC socket: ${IPC_SOCKET}`);
  log.dim(`  Log file: ${DAEMON_LOG}`);
}

function daemonLogs(): void {
  if (!existsSync(DAEMON_LOG)) {
    log.info("No daemon logs yet.");
    return;
  }

  const lines = readFileSync(DAEMON_LOG, "utf8").split("\n").slice(-50);
  for (const line of lines) {
    if (line.trim()) console.error(line);
  }
}

function appendDaemonLog(message: string): void {
  appendFileSync(DAEMON_LOG, `[${new Date().toISOString()}] ${message}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(DAEMON_LOG, 0o600);
}

async function daemonRun(): Promise<void> {
  ensureDirs();
  writeFileSync(PID_FILE, String(process.pid), { mode: 0o600 });
  chmodSync(PID_FILE, 0o600);
  appendDaemonLog("Daemon starting...");

  const instance = new SpotifyInstance(IPC_SOCKET, SAVE_PATH);
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    appendDaemonLog("Daemon shutting down...");
    await instance.stop();
    try { unlinkSync(PID_FILE); } catch {}
  };

  process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.on("SIGINT", () => { void shutdown().then(() => process.exit(0)); });

  try {
    await instance.start();
    appendDaemonLog("Spotify instance ready.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendDaemonLog(`Failed to start Spotify instance: ${message}`);
    try { unlinkSync(PID_FILE); } catch {}
    throw error;
  }

  while (!shuttingDown) {
    await Bun.sleep(15_000);
    if (shuttingDown) break;

    const ok = await ping(IPC_SOCKET);
    if (ok) continue;

    appendDaemonLog("Watchdog: IPC ping failed, restarting instance...");
    try {
      await instance.stop();
      await Bun.sleep(2000);
      await instance.start();
      appendDaemonLog("Watchdog: instance restarted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendDaemonLog(`Watchdog: restart failed: ${message}`);
    }
  }

  await shutdown();
}
