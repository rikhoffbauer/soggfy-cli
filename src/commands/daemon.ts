import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { log } from "../core/log";
import { PID_FILE, DAEMON_LOG, IPC_SOCKET, SAVE_PATH, ensureDirs } from "../core/paths";
import { SpotifyInstance } from "../core/instance";
import { ping } from "../core/ipc";

// @ts-ignore
import indexHtml from "../web/index.html";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      log.error(`Unknown daemon subcommand: ${sub}`);
      process.exit(1);
  }
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  if (isNaN(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    // Stale PID file
    try { unlinkSync(PID_FILE); } catch {}
    return null;
  }
}

function isAlive(): boolean {
  return readPid() !== null;
}

async function daemonStart(): Promise<void> {
  log.header("Starting Daemon");

  if (isAlive()) {
    const pid = readPid();
    log.info(`Daemon already running (PID: ${pid})`);
    return;
  }

  ensureDirs();

  // Resolve the CLI entry point for the subprocess.
  // We use the top-level cli.ts so it routes through the normal command dispatcher.
  const cliPath = `${__dirname}/../cli.ts`;

  // Use nohup + shell to truly detach the subprocess so it survives parent exit.
  // Route stdout/stderr to the daemon log so crashes are diagnosable.
  const proc = Bun.spawn(
    ["sh", "-c", `nohup bun run "${cliPath}" daemon run >> "${DAEMON_LOG}" 2>&1 &\necho $!`],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const rawOut = await new Response(proc.stdout).text();
  await proc.exited;

  const daemonPid = parseInt(rawOut.trim(), 10);
  if (isNaN(daemonPid) || daemonPid <= 0) {
    log.error("Failed to start daemon background process.");
    process.exit(1);
  }

  log.ok(`Daemon started (PID: ${daemonPid})`);

  // Wait for IPC socket to become responsive
  log.info("Waiting for Spotify instance to become ready...");
  for (let i = 0; i < 90; i++) {
    await Bun.sleep(1000);

    // Check if the daemon process is still alive
    try {
      process.kill(daemonPid, 0);
    } catch {
      log.error("Daemon process exited unexpectedly.");
      log.info("Check logs: soggfy daemon logs");
      process.exit(1);
    }

    if (await ping(IPC_SOCKET)) {
      log.ok("Spotify instance ready.");
      return;
    }
  }

  log.warn("Spotify instance did not become ready within timeout.");
  log.info("Check logs: soggfy daemon logs");
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
  } catch {}

  try { unlinkSync(PID_FILE); } catch {}

  // Also kill any leftover Spotify instances from daemon
  Bun.spawnSync(["pkill", "-9", "-f", `SOGGFY_SOCKET_PATH=${IPC_SOCKET}`]);

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
  if (ipcAlive) {
    log.ok("Spotify IPC: responsive");
  } else {
    log.warn("Spotify IPC: not responding");
  }

  log.dim(`  PID file: ${PID_FILE}`);
  log.dim(`  IPC socket: ${IPC_SOCKET}`);
  log.dim(`  Log file: ${DAEMON_LOG}`);
}

function daemonLogs(): void {
  if (!existsSync(DAEMON_LOG)) {
    log.info("No daemon logs yet.");
    return;
  }

  const content = readFileSync(DAEMON_LOG, "utf-8");
  const lines = content.split("\n");
  const tail = lines.slice(-50);
  for (const line of tail) {
    if (line.trim()) console.error(line);
  }
}

/**
 * Run the daemon in the foreground. This is called by `daemon start`
 * via a detached subprocess.
 */
async function daemonRun(): Promise<void> {
  ensureDirs();

  // Write PID file
  writeFileSync(PID_FILE, String(process.pid));

  function appendLog(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { appendFileSync(DAEMON_LOG, line); } catch {}
    // Also print to stdout/stderr so nohup captures it in the log
    console.error(line.trimEnd());
  }

  appendLog("Daemon starting...");

  const instance = new SpotifyInstance(IPC_SOCKET, SAVE_PATH);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    appendLog("Daemon shutting down...");
    await instance.stop();
    try { unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  try {
    await instance.start();
    appendLog("Spotify instance ready.");
  } catch (e: any) {
    appendLog(`Failed to start Spotify instance: ${e.message}`);
    try { unlinkSync(PID_FILE); } catch {}
    process.exit(1);
  }

  // >>> ADD THE HTTP SERVER HERE <<<
  const server = Bun.serve({
    port: 8080,
    routes: {
      "/": indexHtml,
      "/api/status": {
        GET: async () => {
          const ok = await ping(IPC_SOCKET);
          return new Response(
            JSON.stringify({ pid: process.pid, ipcResponsive: ok, savePath: SAVE_PATH }),
            { headers: { "Content-Type": "application/json" } }
          );
        },
      },
      "/api/stream": {
        POST: async (req) => {
          try {
            const body = await req.json();
            if (body.track) {
              const cliPath = `${__dirname}/../cli.ts`;
              // Spawn soggfy stream in the background
              Bun.spawn(["bun", "run", cliPath, "stream", body.track], {
                stdout: "inherit",
                stderr: "inherit",
              });
            }
            return new Response(JSON.stringify({ success: true, track: body.track }));
          } catch (err: any) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });
          }
        },
      },
    },
    development: { hmr: true, console: true },
  });

  appendLog(`Web UI and API server listening on http://localhost:${server.port}`);
  // >>> END HTTP SERVER ADDITION <<<


  // Watchdog loop: ping every 15s, restart if unresponsive
  while (!shuttingDown) {
    await Bun.sleep(3600000);
    if (shuttingDown) break;

    const ok = await ping(IPC_SOCKET);
    if (!ok) {
      appendLog("Watchdog: IPC ping failed, restarting instance...");
      try {
        await instance.stop();
        await Bun.sleep(2000);
        await instance.start();
        appendLog("Watchdog: Instance restarted.");
      } catch (e: any) {
        appendLog(`Watchdog: Restart failed: ${e.message}`);
      }
    }
  }
}
