import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { listLogSources, readLogTail } from "../logs";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soggfy-logs-"));
  roots.push(root);
  const logs = join(root, "logs");
  const runtime = join(root, "runtime");
  const profiles = join(root, "profiles");
  const payload = join(root, "payload");
  mkdirSync(logs); mkdirSync(runtime); mkdirSync(profiles); mkdirSync(payload);
  return { root, logs, runtime, profiles, payload };
}

test("log catalog includes daemon, payload, Spotify, and historical log files only", () => {
  const f = fixture();
  mkdirSync(join(f.runtime, "instance_1"));
  mkdirSync(join(f.profiles, "instance_1"));
  writeFileSync(join(f.logs, "daemon.log"), "daemon\n");
  writeFileSync(join(f.logs, "probe.log"), "probe\n");
  writeFileSync(join(f.runtime, "instance_1", "payload-12.log"), "payload\n");
  writeFileSync(join(f.profiles, "instance_1", "spotify.err"), "stderr\n");
  writeFileSync(join(f.profiles, "instance_1", "spotify.log"), "stdout\n");
  mkdirSync(join(f.runtime, "instance_1", "Caches", "leveldb"), { recursive: true });
  mkdirSync(join(f.payload, "Caches", "leveldb"), { recursive: true });
  writeFileSync(join(f.runtime, "instance_1", "Caches", "leveldb", "000003.log"), "db\n");
  writeFileSync(join(f.payload, "Caches", "leveldb", "000004.log"), "db\n");
  writeFileSync(join(f.logs, "ignore.json"), "{}\n");

  const sources = listLogSources({
    logDir: f.logs,
    runtimeDir: f.runtime,
    profilesDir: f.profiles,
    payloadDir: f.payload,
  });
  expect(sources.map((source) => source.label)).toEqual([
    "daemon.log",
    "probe.log",
    "runtime/instance_1/payload-12.log",
    "profiles/instance_1/spotify.err",
    "profiles/instance_1/spotify.log",
  ]);
  expect(sources.some((source) => source.path.endsWith("ignore.json"))).toBe(false);
  expect(sources.some((source) => /leveldb\/00000[34]\.log$/.test(source.path))).toBe(false);
});

test("readLogTail returns bounded newest lines without exposing arbitrary paths", () => {
  const f = fixture();
  const path = join(f.logs, "daemon.log");
  writeFileSync(path, "one\ntwo\nthree\nfour\n");
  const source = listLogSources({
    logDir: f.logs,
    runtimeDir: f.runtime,
    profilesDir: f.profiles,
    payloadDir: f.payload,
  })[0]!;
  expect(readLogTail(source, 2)).toMatchObject({ lines: ["three", "four"], truncated: true });
});

import { decodeLogTail } from "../logs";


test("readLogTail keeps a complete first line when byte window starts after newline", () => {
  const f = fixture();
  const path = join(f.logs, "boundary.log");
  const maxTailBytes = 2 * 1024 * 1024;
  const tail = `first\n${"x".repeat(maxTailBytes - 6)}`;
  writeFileSync(path, `prefix\n${tail}`);
  const source = listLogSources({
    logDir: f.logs,
    runtimeDir: f.runtime,
    profilesDir: f.profiles,
    payloadDir: f.payload,
  }).find((item) => item.label === "boundary.log")!;
  expect(readLogTail(source, 10).lines[0]).toBe("first");
});

test("tail decoding ignores unread bytes when a file shrinks during read", () => {
  const buffer = Buffer.concat([Buffer.from("one\ntwo"), Buffer.alloc(8, 0)]);
  expect(decodeLogTail(buffer, { bytesRead: 7, start: 0, lineLimit: 10 })).toEqual({
    lines: ["one", "two"],
    truncated: false,
  });
});
