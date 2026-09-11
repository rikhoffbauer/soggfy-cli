import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { createConnection } from "node:net";
import { tmpdir } from "os";
import {
  readDaemonIdentity,
  readDaemonIdentityToken,
  startDaemonIdentityServer,
  verifyDaemonIdentity,
} from "../src/core/daemon-identity";

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

test("daemon identity requires live control socket to prove launch token", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-daemon-id-"));
  roots.push(root);
  const socketPath = join(root, "daemon.sock");
  const server = await startDaemonIdentityServer(socketPath, "correct-token", "http://10.0.0.2:8085");
  try {
    expect(await readDaemonIdentity(socketPath)).toEqual({
      token: "correct-token",
      httpOrigin: "http://10.0.0.2:8085",
    });
    expect(await readDaemonIdentityToken(socketPath)).toBe("correct-token");
    expect(await verifyDaemonIdentity(socketPath, "correct-token")).toBe(true);
    expect(await verifyDaemonIdentity(socketPath, "wrong-token")).toBe(false);
  } finally {
    await server.close();
  }
});

test("daemon identity server refuses to steal a live control socket", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-daemon-id-live-"));
  roots.push(root);
  const socketPath = join(root, "daemon.sock");
  const first = await startDaemonIdentityServer(socketPath, "first-token");
  try {
    await expect(startDaemonIdentityServer(socketPath, "second-token"))
      .rejects.toThrow("already active");
    expect(await verifyDaemonIdentity(socketPath, "first-token")).toBe(true);
  } finally {
    await first.close();
  }
});


test("JSON-looking legacy daemon tokens stay opaque without a protocol marker", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-daemon-id-legacy-json-"));
  roots.push(root);
  const socketPath = join(root, "daemon.sock");
  const { createServer } = await import("node:net");
  const server = createServer((socket) => socket.end('{"token":"legacy-looking-json"}\n'));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  try {
    expect(await readDaemonIdentity(socketPath)).toEqual({ token: '{"token":"legacy-looking-json"}' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});


test("daemon identity server survives clients that disconnect before a delayed reply", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-daemon-id-disconnect-"));
  roots.push(root);
  const socketPath = join(root, "daemon.sock");
  const child = Bun.spawn([
    process.execPath,
    "-e",
    `import { startDaemonIdentityServer } from "./src/core/daemon-identity.ts";
const server = await startDaemonIdentityServer(${JSON.stringify(socketPath)}, "token");
process.stdout.write("READY\\n");
const until = Date.now() + 350;
while (Date.now() < until) {}
await Bun.sleep(150);
await server.close();`,
  ], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = child.stdout.getReader();
  let ready = "";
  while (!ready.includes("READY\n")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    ready += new TextDecoder().decode(chunk.value);
  }
  expect(ready).toContain("READY\n");

  const socket = createConnection({ path: socketPath });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.destroy();

  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
});
