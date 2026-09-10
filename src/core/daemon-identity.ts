import { chmodSync, existsSync, unlinkSync } from "fs";
import { createConnection, createServer, type Server } from "node:net";

export interface DaemonIdentityServer {
  close(): Promise<void>;
}

async function readDaemonIdentity(socketPath: string, timeoutMs = 500): Promise<string | null> {
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

export async function startDaemonIdentityServer(
  socketPath: string,
  token: string,
): Promise<DaemonIdentityServer> {
  if (existsSync(socketPath)) {
    const liveIdentity = await readDaemonIdentity(socketPath);
    if (liveIdentity !== null) {
      throw new Error(`Daemon identity socket is already active: ${socketPath}`);
    }
    unlinkSync(socketPath);
  }

  const server = createServer((socket) => socket.end(`${token}\n`));
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
  return (await readDaemonIdentity(socketPath, timeoutMs)) === expectedToken;
}
