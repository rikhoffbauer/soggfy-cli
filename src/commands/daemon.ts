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
import { randomUUID } from "crypto";
import { createServer } from "node:net";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { log } from "../core/log";
import {
  PID_FILE, DAEMON_LOG, DAEMON_SOCKET, DAEMON_START_LOCK,
  IPC_SOCKET, SAVE_PATH, ensureDirs,
} from "../core/paths";
import { SpotifyInstance } from "../core/instance";
import { registerDaemonSpotifyInstance, unregisterDaemonSpotifyInstance } from "../core/daemon-runtime";
import { ping } from "../core/ipc";
import { getHttpConfig, getHttpOrigin } from "../core/http-config";
import { acquireDaemonStartLock } from "../core/daemon-lock";
import { startDaemonIdentityServer, verifyDaemonIdentity } from "../core/daemon-identity";

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
  run       Run daemon + web server in foreground (internal)
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

interface DaemonRecord {
  pid: number;
  token: string;
  startedAt: string;
}

function readDaemonRecord(): DaemonRecord | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const value = JSON.parse(readFileSync(PID_FILE, "utf8"));
    if (!Number.isInteger(value?.pid) || value.pid <= 0 || typeof value?.token !== "string" || !value.token) {
      return null;
    }
    return {
      pid: value.pid,
      token: value.token,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : "unknown",
    };
  } catch {
    return null;
  }
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function removePidRecord(record?: DaemonRecord): void {
  if (record) {
    const current = readDaemonRecord();
    if (!current || current.pid !== record.pid || current.token !== record.token) return;
  }
  try { unlinkSync(PID_FILE); } catch {}
}

async function getVerifiedDaemonRecord(): Promise<DaemonRecord | null> {
  const record = readDaemonRecord();
  if (!record) return null;
  if (!processExists(record.pid)) {
    removePidRecord(record);
    return null;
  }
  if (!(await verifyDaemonIdentity(DAEMON_SOCKET, record.token))) {
    removePidRecord(record);
    return null;
  }
  return record;
}

export async function isHttpEndpointOccupied(
  config = getHttpConfig(),
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (occupied: boolean) => {
      if (settled) return;
      settled = true;
      resolve(occupied);
    };

    server.once("error", () => finish(true));
    server.listen({ host: config.host, port: config.port, exclusive: true }, () => {
      server.close(() => finish(false));
    });
  });
}

function spawnDaemonProcess(): number {
  const cliEntry = process.argv[1];
  if (!cliEntry) throw new Error("Cannot determine current CLI entrypoint");

  const logFd = openSync(DAEMON_LOG, "a", 0o600);
  chmodSync(DAEMON_LOG, 0o600);
  try {
    const child = spawn(process.execPath, [cliEntry, "daemon", "run"], {
      cwd: resolveWebappWorkingDirectory(),
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
  ensureDirs();

  let startLock;
  try {
    startLock = acquireDaemonStartLock(DAEMON_START_LOCK);
  } catch (error) {
    const running = await getVerifiedDaemonRecord();
    if (running) {
      log.info(`Daemon already running (PID: ${running.pid})`);
      return;
    }
    throw error;
  }

  try {
    const running = await getVerifiedDaemonRecord();
    if (running) {
      log.info(`Daemon already running (PID: ${running.pid})`);
      return;
    }

    const httpConfig = getHttpConfig();
    if (await isHttpEndpointOccupied(httpConfig)) {
      log.info("Configured web address is already in use; daemon not started.");
      log.dim(`  Address: ${httpConfig.host}:${httpConfig.port}`);
      return;
    }

    const daemonPid = spawnDaemonProcess();
    log.ok(`Daemon started (PID: ${daemonPid})`);
    const httpOrigin = getHttpOrigin(httpConfig);
    log.info("Waiting for Spotify instance and web UI/API to become ready...");

    for (let i = 0; i < 90; i++) {
      await Bun.sleep(1000);
      if (!processExists(daemonPid)) {
        throw new Error("Daemon process exited unexpectedly. Check: soggfy daemon logs");
      }
      const identity = await getVerifiedDaemonRecord();
      const spotifyReady = identity?.pid === daemonPid && await ping(IPC_SOCKET);
      const webReady = spotifyReady && await isWebServerHealthy(httpOrigin);
      if (identity?.pid === daemonPid && spotifyReady && webReady) {
        log.ok("Daemon ready: Spotify IPC and web UI/API are responsive.");
        log.dim(`  Web UI/API: ${httpOrigin}`);
        return;
      }
    }

    try { process.kill(daemonPid, "SIGTERM"); } catch {}
    throw new Error("Daemon did not become fully ready within 90 seconds. Check: soggfy daemon logs");
  } finally {
    startLock.release();
  }
}

async function daemonStop(): Promise<void> {
  log.header("Stopping Daemon");
  const record = await getVerifiedDaemonRecord();
  if (!record) {
    log.info("Daemon is not running or its identity cannot be verified.");
    return;
  }

  try {
    process.kill(record.pid, "SIGTERM");
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(250);
      if (!processExists(record.pid)) break;
    }
    if (processExists(record.pid)) {
      process.kill(record.pid, "SIGKILL");
    }
  } catch {} finally {
    removePidRecord(record);
  }

  log.ok(`Daemon stopped (was PID: ${record.pid})`);
}

async function daemonStatus(): Promise<void> {
  log.header("Daemon Status");
  const record = await getVerifiedDaemonRecord();
  if (!record) {
    log.info("Daemon is not running or its identity cannot be verified.");
    return;
  }

  log.ok(`Daemon running (PID: ${record.pid})`);
  const ipcAlive = await ping(IPC_SOCKET);
  if (ipcAlive) log.ok("Spotify IPC: responsive");
  else log.warn("Spotify IPC: not responding");

  const httpOrigin = getHttpOrigin();
  const webAlive = await isWebServerHealthy(httpOrigin);
  if (webAlive) log.ok(`Web UI/API: responsive (${httpOrigin})`);
  else log.warn(`Web UI/API: not responding (${httpOrigin})`);

  log.dim(`  PID file: ${PID_FILE}`);
  log.dim(`  Identity socket: ${DAEMON_SOCKET}`);
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

async function isWebServerHealthy(origin = getHttpOrigin()): Promise<boolean> {
  try {
    const token = process.env.SOGGFY_API_TOKEN?.trim();
    const response = await fetch(`${origin}/api/health`, token ? {
      headers: { authorization: `Bearer ${token}` },
    } : undefined);
    if (!response.ok) return false;
    const body = await response.json() as { ok?: boolean; started?: boolean };
    return body.ok === true && body.started === true;
  } catch {
    return false;
  }
}

function appendDaemonLog(message: string): void {
  appendFileSync(DAEMON_LOG, `[${new Date().toISOString()}] ${message}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(DAEMON_LOG, 0o600);
}

export function resolveWebappWorkingDirectory(
  moduleDir = dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  const candidates = [
    resolve(moduleDir, "../webapp"),
    resolve(moduleDir, "../../webapp"),
  ];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "server.js")) || existsSync(resolve(candidate, "bunfig.toml"))) return candidate;
  }
  return undefined;
}

export function resolveWebappServerEntry(moduleDir = dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [
    resolve(moduleDir, "../webapp/server.js"),
    resolve(moduleDir, "../../webapp/src/index.ts"),
    resolve(moduleDir, "../webapp/src/index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Webapp server entry not found. Checked: ${candidates.join(", ")}`);
}

async function daemonRun(): Promise<void> {
  ensureDirs();
  const token = randomUUID();
  const identityServer = await startDaemonIdentityServer(DAEMON_SOCKET, token);
  const record: DaemonRecord = {
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(PID_FILE, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  chmodSync(PID_FILE, 0o600);
  appendDaemonLog("Daemon starting...");

  const instance = new SpotifyInstance(IPC_SOCKET, SAVE_PATH);
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    appendDaemonLog("Daemon shutting down...");
    unregisterDaemonSpotifyInstance(instance);
    try { await instance.stop(); } catch (error) {
      appendDaemonLog(`Spotify shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try { await identityServer.close(); } catch {}
    removePidRecord(record);
  };

  process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.on("SIGINT", () => { void shutdown().then(() => process.exit(0)); });

  try {
    await instance.start();
    appendDaemonLog("Spotify instance ready.");
    registerDaemonSpotifyInstance(instance);
    process.env.SOGGFY_USE_DAEMON_INSTANCE = "1";
    const webappEntryUrl = pathToFileURL(resolveWebappServerEntry()).href;
    await import(webappEntryUrl);
    const httpConfig = getHttpConfig();
    appendDaemonLog(`Web UI/API ready at ${getHttpOrigin(httpConfig)}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendDaemonLog(`Daemon startup failed: ${message}`);
    await shutdown();
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
