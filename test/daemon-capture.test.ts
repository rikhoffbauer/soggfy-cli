import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { captureTrackViaDaemon, daemonApiHealthy } from "../src/core/daemon-capture";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const trackId = "4PTG3Z6ehGkBFwjybzWkR8";

test("daemon health probe requires a started healthy scheduler", async () => {
  const healthy = await daemonApiHealthy({
    origin: "http://daemon.test",
    fetchImpl: (async (input) => {
      expect(String(input)).toBe("http://daemon.test/api/health");
      return Response.json({ ok: true, started: true });
    }) as typeof fetch,
  });
  expect(healthy).toBe(true);

  const unhealthy = await daemonApiHealthy({
    origin: "http://daemon.test",
    fetchImpl: (async () => Response.json({ ok: true, started: false })) as typeof fetch,
  });
  expect(unhealthy).toBe(false);
});

test("daemon capture submits through scheduler and waits for the exact returned job", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-daemon-capture-"));
  roots.push(root);
  const audio = join(root, `${trackId}.mp3`);
  writeFileSync(audio, "fixture-audio");
  const calls: Array<{ url: string; method: string; body?: string | null }> = [];
  let snapshots = 0;

  const fakeFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ url, method, body: typeof init.body === "string" ? init.body : null });
    if (url.endsWith("/api/download")) {
      expect(method).toBe("POST");
      expect(new Headers(init.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init.body))).toEqual({ trackId });
      return Response.json({
        jobs: [{ id: "cli-job", trackId, state: "queued" }],
        jobIds: ["cli-job"],
      });
    }
    if (url.endsWith("/api/jobs")) {
      snapshots += 1;
      if (snapshots === 1) {
        return Response.json({
          jobs: [
            { id: "other-job", trackId, state: "completed", savedPath: audio },
            { id: "cli-job", trackId, state: "capturing" },
          ],
        });
      }
      return Response.json({
        jobs: [{
          id: "cli-job",
          trackId,
          state: "completed",
          savedPath: audio,
          sizeBytes: 13,
          durationMs: 1234,
          metadata: { title: "Fixture", artist: "Artist" },
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const result = await captureTrackViaDaemon(trackId, {
    origin: "http://daemon.test",
    fetchImpl: fakeFetch,
    pollMs: 0,
    timeoutMs: 1000,
  });

  expect(result).toMatchObject({
    trackId,
    wavPath: audio,
    bytesWritten: 13,
    durationMs: 1234,
    metadata: { title: "Fixture", artist: "Artist" },
  });
  expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
    "POST /api/download",
    "GET /api/jobs",
    "GET /api/jobs",
  ]);
});

test("daemon capture surfaces scheduler failure without falling back to direct IPC", async () => {
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/download")) {
      return Response.json({ jobs: [{ id: "failed-job", trackId, state: "queued" }] });
    }
    if (url.endsWith("/api/jobs")) {
      return Response.json({ jobs: [{ id: "failed-job", trackId, state: "failed", error: "fixture failure" }] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  await expect(captureTrackViaDaemon(trackId, {
    origin: "http://daemon.test",
    fetchImpl: fakeFetch,
    pollMs: 0,
    timeoutMs: 1000,
  })).rejects.toThrow("fixture failure");
});

test("daemon health uses the HTTP origin published by the daemon identity socket", async () => {
  const { startDaemonIdentityServer } = await import("../src/core/daemon-identity");
  const root = mkdtempSync(join(tmpdir(), "soggfy-daemon-origin-"));
  roots.push(root);
  const socketPath = join(root, "daemon.sock");
  const server = await startDaemonIdentityServer(socketPath, "fixture-token", "http://127.0.0.1:19085");
  const calls: string[] = [];
  try {
    const healthy = await daemonApiHealthy({
      identitySocket: socketPath,
      fetchImpl: (async (input) => {
        calls.push(String(input));
        return Response.json({ ok: true, started: true });
      }) as typeof fetch,
    });
    expect(healthy).toBe(true);
    expect(calls).toEqual(["http://127.0.0.1:19085/api/health"]);
  } finally {
    await server.close();
  }
});
