import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { streamGrowingFile } from "../growing-file";

const dirs: string[] = [];
function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), "soggfy-growing-"));
  dirs.push(dir);
  return join(dir, "track.ogg");
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("waits for a delayed file and streams appended bytes until terminal", async () => {
  const path = tempPath();
  let state = "capturing";
  const response = streamGrowingFile({
    getPath: () => path,
    getState: () => state,
    startupTimeoutMs: 500,
    pollMs: 10,
  });
  await sleep(30);
  writeFileSync(path, Buffer.from("OggS-header"));
  await sleep(30);
  appendFileSync(path, Buffer.from("-page-two"));
  await sleep(30);
  state = "completed";

  expect(response.headers.get("content-type")).toBe("audio/ogg");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("OggS-header-page-two");
});

test("does not append bytes from a replacement file after shrink", async () => {
  const path = tempPath();
  writeFileSync(path, Buffer.from("OggS-original-long-page"));
  let state = "capturing";
  const response = streamGrowingFile({
    getPath: () => path,
    getState: () => state,
    startupTimeoutMs: 200,
    pollMs: 10,
  });
  await sleep(35);
  writeFileSync(path, Buffer.from("NEW"));
  await sleep(20);
  state = "completed";
  const body = Buffer.from(await response.arrayBuffer()).toString();
  expect(body).toBe("OggS-original-long-page");
  expect(body).not.toContain("NEW");
});

test("client abort closes the producer without changing capture state", async () => {
  const path = tempPath();
  writeFileSync(path, Buffer.from("OggS-header"));
  let state = "capturing";
  const controller = new AbortController();
  const response = streamGrowingFile({
    getPath: () => path,
    getState: () => state,
    signal: controller.signal,
    startupTimeoutMs: 200,
    pollMs: 10,
  });
  await sleep(25);
  controller.abort();
  const body = Buffer.from(await response.arrayBuffer()).toString();
  expect(body).toBe("OggS-header");
  expect(state).toBe("capturing");
});

test("startup timeout closes the media response cleanly when no capture file appears", async () => {
  const path = tempPath();
  const response = streamGrowingFile({
    getPath: () => path,
    getState: () => "capturing",
    startupTimeoutMs: 30,
    pollMs: 5,
  });
  expect(Buffer.from(await response.arrayBuffer())).toHaveLength(0);
});

test("stream route attaches to an existing exact job and never creates one", async () => {
  const { readFileSync } = await import("fs");
  const source = readFileSync(join(import.meta.dir, "../routes.ts"), "utf8");
  expect(source).toContain("streamGrowingFile");
  expect(source).toContain('url.searchParams.get("job")');
  expect(source).not.toContain("stream-triggered job failed");
});
