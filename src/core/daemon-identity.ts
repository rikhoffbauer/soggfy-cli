import { chmodSync, existsSync, unlinkSync } from "fs";
import { createConnection, createServer, type Server } from "node:net";

const IDENTITY_V1_PREFIX = "SOGGFY_DAEMON_IDENTITY_V1 ";

export interface DaemonIdentity {
  token: string;
  httpOrigin?: string;
}

export interface DaemonIdentityServer {
  close(): Promise<void>;
}

async function readDaemonIdentityPayload(socketPath: string, timeoutMs = 500): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    let settled = false;
    let data = "";
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = createConnection({ path: socketPath });
    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
    socket.on("end", () => finish(data.trim() || null));
    socket.on("error", () => finish(null));
    socket.on("timeout", () => finish(null));
  });
}

export async function readDaemonIdentity(
  socketPath: string,
  timeoutMs = 500,
): Promise<DaemonIdentity | null> {
  const payload = await readDaemonIdentityPayload(socketPath, timeoutMs);
  if (!payload) return null;
  if (!payload.startsWith(IDENTITY_V1_PREFIX)) return { token: payload };
  try {
    const parsed = JSON.parse(payload.slice(IDENTITY_V1_PREFIX.length));
    if (typeof parsed?.token !== "string" || !parsed.token) return null;
    return {
      token: parsed.token,
      httpOrigin: typeof parsed.httpOrigin === "string" && parsed.httpOrigin ? parsed.httpOrigin : undefined,
    };
  } catch {
    return null;
  }
}

export async function readDaemonIdentityToken(socketPath: string, timeoutMs = 500): Promise<string | null> {
  return (await readDaemonIdentity(socketPath, timeoutMs))?.token ?? null;
}

export async function startDaemonIdentityServer(
  socketPath: string,
  token: string,
  httpOrigin?: string,
): Promise<DaemonIdentityServer> {
  if (existsSync(socketPath)) {
    const liveIdentity = await readDaemonIdentity(socketPath);
    if (liveIdentity !== null) {
      throw new Error(`Daemon identity socket is already active: ${socketPath}`);
    }
    unlinkSync(socketPath);
  }

  const identity: DaemonIdentity = { token, ...(httpOrigin ? { httpOrigin } : {}) };
  const payload = `${IDENTITY_V1_PREFIX}${JSON.stringify(identity)}\n`;
  const server = createServer((socket) => {
    // Readiness probes may time out while daemon startup is synchronously
    // preparing Spotify state. A peer that disconnects before this callback
    // writes its reply must not crash the daemon with an unhandled EPIPE.
    socket.on("error", () => socket.destroy());
    socket.end(payload);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  chmodSync(socketPath, 0o600);
  return {
    async close() {
      await closeServer(server);
      try { if (existsSync(socketPath)) unlinkSync(socketPath); } catch {}
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function verifyDaemonIdentity(
  socketPath: string,
  expectedToken: string,
  timeoutMs = 750,
): Promise<boolean> {
  return (await readDaemonIdentityToken(socketPath, timeoutMs)) === expectedToken;
}
