import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
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
