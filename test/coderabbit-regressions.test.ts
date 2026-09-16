import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHttpConfig } from "../src/core/http-config";
import { getHelpTopic } from "../src/core/help";
import { displayFileName } from "../src/core/media";
import { readBoundedStreamText } from "../src/core/transcode";
import { CaptureTraceRecorder, replayCaptureTrace, type CaptureTraceRecord } from "../src/core/capture-trace";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("HTTP port parsing rejects trailing garbage", () => {
  expect(() => getHttpConfig({ SOGGFY_PORT: "8085junk" })).toThrow("Invalid SOGGFY_PORT");
  expect(getHttpConfig({ SOGGFY_PORT: " 8085 " }).port).toBe(8085);
});

test("help lookup rejects inherited object keys", () => {
  expect(getHelpTopic("constructor")).toBeNull();
  expect(getHelpTopic("__proto__")).toBeNull();
  expect(getHelpTopic("valueOf")).toBeNull();
});

test("display filename never derives an extension from a title", () => {
  expect(displayFileName("track", { title: "Song.Title" })).toBe("Song.Title.bin");
  expect(displayFileName("track", { title: "Song" }, ".mp3")).toBe("Song.mp3");
});

test("capture byte monotonicity is tracked per capture path", () => {
  const records: CaptureTraceRecord[] = [
    { version: 1, sequence: 1, atMs: 0, trackId: "t", type: "bytes", path: "t.wav", bytes: 4096 },
    { version: 1, sequence: 2, atMs: 1, trackId: "t", type: "bytes", path: "t.ogg", bytes: 512 },
    { version: 1, sequence: 3, atMs: 2, trackId: "t", type: "bytes", path: "t.ogg", bytes: 1024 },
  ];
  expect(replayCaptureTrace(records).maximumBytes).toBe(4096);
});

test("capture recorder preserves invariant-breaking evidence without throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "soggfy-trace-review-"));
  try {
    const recorder = new CaptureTraceRecorder("t", dir);
    recorder.record({ type: "bytes", path: "t.ogg", bytes: 4096 });
    expect(() => recorder.record({ type: "bytes", path: "t.ogg", bytes: 1024 })).not.toThrow();
    const lines = readFileSync(recorder.path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.some((line) => line.type === "bytes" && line.bytes === 1024)).toBe(false);
    expect(lines.some((line) => line.type === "error" && /decreased/.test(line.message))).toBe(true);
    expect(() => replayCaptureTrace(lines)).not.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("private temporary Spotify launches avoid predictable /tmp paths", () => {
  const download = source("src/commands/download.ts");
  const compat = source("src/core/compat-probe.ts");
  expect(download).toContain("mkdtempSync");
  expect(download).not.toContain("/tmp/soggfy_download_${process.pid}.sock");
  expect(compat).toContain('join(runDir, "ipc.sock")');
  expect(compat).not.toContain("/tmp/soggfy-compat-");
});

test("health probes have a deadline and compatibility uses one capture-driven playback flow", () => {
  const daemon = source("src/commands/daemon.ts");
  const compat = source("src/core/compat-probe.ts");
  expect(daemon).toContain("AbortSignal.timeout");
  expect((compat.match(/await captureTrack\(/g) ?? []).length).toBe(1);
  expect(compat).not.toContain("verifyTargetPlayback");
  expect(compat).toContain("CGWindowListCopyWindowInfo");
  expect(compat).toContain("timeout: 20_000");
});

test("capture monitor handles stat races and cleans up prolonged IPC loss", () => {
  const capture = source("src/core/capture.ts");
  expect(capture).toMatch(/try\s*\{[^}]*statSync\(currentPath\)\.size/s);
  expect(capture).toContain('trace.record({ type: "error", message: "IPC lost during capture" })');
  expect(capture).toContain(`tracedSend(\`cancel_track \${trackId}\`)`);
});

test("raw transcoding uses a synchronous write and ffmpeg streaming handles writer failure", () => {
  const transcode = source("src/core/transcode.ts");
  expect(transcode).toContain("writeFileSync(outputPath");
  expect(transcode).toContain("const stderrText = readBoundedStreamText(proc.stderr");
  expect(transcode).not.toContain("new Response(proc.stderr).text()");
  expect(transcode).toContain("proc.kill()");
});

test("top-level CLI rejection handling does not dereference arbitrary rejection values", () => {
  const cli = source("src/cli.ts");
  expect(cli).toContain("err instanceof Error ? err.message : String(err)");
});

test("fingerprint command validates the complete positive integer length", () => {
  const fingerprint = source("src/commands/fingerprint.ts");
  expect(fingerprint).toContain("Number(");
  expect(fingerprint).toMatch(/Number\.isInteger\(length\)/);
  expect(fingerprint).toMatch(/length\s*<=\s*0/);
});


test("compatibility probes reject Unix socket paths that cannot fit sun_path", async () => {
  const module = await import("../src/core/compat-probe") as Record<string, unknown>;
  const assertCompatSocketPath = module.assertCompatSocketPath;
  expect(typeof assertCompatSocketPath).toBe("function");
  const validate = assertCompatSocketPath as (path: string) => void;
  expect(() => validate(`/tmp/${"é".repeat(60)}/ipc.sock`)).toThrow("Unix socket path is too long");
  expect(() => validate("/tmp/soggfy-compat.sock")).not.toThrow();
});

test("best-effort capture tracing disables itself after the first filesystem error", async () => {
  const module = await import("../src/core/capture-trace") as Record<string, unknown>;
  const Recorder = module.BestEffortCaptureTraceRecorder as any;
  expect(typeof Recorder).toBe("function");
  const root = mkdtempSync(join(tmpdir(), "soggfy-best-effort-trace-"));
  const traceDir = join(root, "trace");
  let warnings = 0;
  try {
    const trace = new Recorder("track", { traceDir, onError: () => warnings++ });
    rmSync(traceDir, { recursive: true, force: true });
    expect(() => trace.command("ping")).not.toThrow();
    expect(() => trace.response("ping", "pong")).not.toThrow();
    expect(warnings).toBe(1);

    const blocker = join(root, "blocker");
    writeFileSync(blocker, "not a directory");
    const failed = new Recorder("track-2", { traceDir: join(blocker, "child"), onError: () => warnings++ });
    expect(failed.path).toBeNull();
    expect(() => failed.command("ping")).not.toThrow();
    expect(warnings).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("bounded stream diagnostics drain all input while retaining only a fixed prefix", async () => {
  const encoder = new TextEncoder();
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls <= 4) controller.enqueue(encoder.encode("abcdefgh"));
      else controller.close();
    },
  });
  const text = await readBoundedStreamText(stream, 10);
  expect(text).toBe("abcdefghab\n[stderr truncated]");
  expect(pulls).toBeGreaterThanOrEqual(5);
});
