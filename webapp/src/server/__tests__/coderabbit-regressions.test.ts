import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { apiRequestInit } from "../../api-auth";
import { apiSecurityFromEnv, protectApiRoutes } from "../security";
import { JobRegistry } from "../jobs";
import { serveFileWithRange } from "../http";
import { fetchTrackMetadata } from "../spotify-metadata";
import { parseTrackId } from "../spotify-url";
import { resolveRepoRoot, resolveWebRoot } from "../runtime-config";
import { sanitizedSpotifyEnvironment } from "../spotify-instance";

const root = join(import.meta.dir, "../../../..");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

test("API request resolution preserves the current page path while comparing origins separately", () => {
  const init = apiRequestInit("api/jobs", {}, "secret", "http://host:8085/app/page?token=x");
  expect(new Headers(init.headers).get("x-soggfy-token")).toBeNull();
  const same = apiRequestInit("/api/jobs", {}, "secret", "http://host:8085/app/page?token=x");
  expect(new Headers(same.headers).get("x-soggfy-token")).toBe("secret");
});

test("valid bearer requests reuse an existing valid session cookie", async () => {
  const security = apiSecurityFromEnv("0.0.0.0", { SOGGFY_API_TOKEN: "secret" });
  const routes = protectApiRoutes({ "/api/x": { GET: () => new Response("ok") } }, security);
  const first = await routes["/api/x"].GET(new Request("http://host/api/x", { headers: { authorization: "Bearer secret" } }));
  const pair = first.headers.get("set-cookie")!.split(";", 1)[0]!;
  const second = await routes["/api/x"].GET(new Request("http://host/api/x", { headers: { authorization: "Bearer secret", cookie: pair } }));
  expect(second.headers.get("set-cookie")).toBeNull();
});

test("legacy job status keeps authoritative job fields over metadata", () => {
  const registry = new JobRegistry();
  const job = registry.create("4PTG3Z6ehGkBFwjybzWkR8", { title: "Song" } as any);
  (job.metadata as any).state = "failed";
  (job.metadata as any).status = "failed";
  expect(registry.toLegacyStatus()[job.trackId]).toMatchObject({ state: "queued", status: "pending" });
});

test("hydration never replaces an existing job with the same persisted ID", () => {
  const dir = mkdtempSync(join(tmpdir(), "soggfy-hydrate-review-")); dirs.push(dir);
  const registry = new JobRegistry();
  const existing = registry.create("AAAAAAAAAAAAAAAAAAAAAA");
  const audio = join(dir, "x.mp3");
  writeFileSync(audio, "audio");
  writeFileSync(`${audio}.json`, JSON.stringify({ jobId: existing.id, trackId: "BBBBBBBBBBBBBBBBBBBBBB", completedAt: new Date().toISOString() }));
  expect(registry.hydrateFromOutputDir(dir)).toBe(0);
  expect(registry.get(existing.id)).toBe(existing);
});

test("OGG files are served with audio/ogg", () => {
  const dir = mkdtempSync(join(tmpdir(), "soggfy-http-review-")); dirs.push(dir);
  const path = join(dir, "x.ogg"); writeFileSync(path, "OggS");
  const response = serveFileWithRange(new Request("http://host/file"), path);
  expect(response.headers.get("content-type")).toBe("audio/ogg");
});

test("Spotify parsers trim bare IDs and metadata without an entity is null", async () => {
  const id = "4PTG3Z6ehGkBFwjybzWkR8";
  expect(parseTrackId(`  ${id}  `)).toBe(id);
  const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"data":{}}}}}</script>';
  expect(await fetchTrackMetadata(id, (async () => new Response(html)) as unknown as typeof fetch)).toBeNull();
});

test("server build checks Bun.build success and watchdog prevents overlap", () => {
  expect(source("webapp/build.ts")).toContain("result.success");
  const pool = source("webapp/src/server/pool.ts");
  expect(pool).toMatch(/let\s+running\s*=\s*false/);
  expect(pool).toContain("if (running) return");
});

test("daemon IPC health checks tolerate transient blocked replies", () => {
  const daemon = source("src/commands/daemon.ts");
  const spotify = source("webapp/src/server/spotify-instance.ts");
  expect(daemon).toContain("ping(IPC_SOCKET, { retries: 3, timeoutMs: 3_000 })");
  expect(spotify).toContain("async ping(retries = 3, timeoutMs = 2_000)");
  expect(spotify).toContain('this.sendIPC("ping", retries, timeoutMs)');
});

test("server HTML prevents token-bearing URLs from leaking as referrers", () => {
  const html = source("webapp/src/index.html");
  expect(html).toContain('<meta name="referrer" content="no-referrer" />');
});

test("Spotify child environment does not inherit API credentials", () => {
  const spotify = source("webapp/src/server/spotify-instance.ts");
  expect(spotify).not.toContain("...process.env,");
  expect(spotify).toContain("sanitizedSpotifyEnvironment");
});



test("Spotify child environment strips TLS key logging as well as API credentials", () => {
  const sanitized = sanitizedSpotifyEnvironment({
    HOME: "/tmp/home",
    SSLKEYLOGFILE: "/tmp/keys.log",
    SOGGFY_API_TOKEN: "secret",
    SPOTIFY_ACCESS_TOKEN: "access",
  });
  expect(sanitized.HOME).toBe("/tmp/home");
  expect(sanitized.SSLKEYLOGFILE).toBeUndefined();
  expect(sanitized.SOGGFY_API_TOKEN).toBeUndefined();
  expect(sanitized.SPOTIFY_ACCESS_TOKEN).toBeUndefined();
});

test("runtime repository root supports source and bundled server layouts", () => {
  expect(resolveRepoRoot("/repo/webapp/src/server")).toBe(resolve("/repo"));
  expect(resolveRepoRoot("/repo/dist/webapp")).toBe(resolve("/repo"));
  expect(resolveRepoRoot("/repo/dist/webapp/versions/build-123")).toBe(resolve("/repo"));
});

test("bundled runtime can explicitly locate external web assets", () => {
  expect(resolveWebRoot("/Applications/Sonata/Soggfy.bundle", "/tmp/sonata-web")).toBe(resolve("/tmp/sonata-web"));
  expect(resolveWebRoot("/repo/dist/webapp")).toBe(resolve("/repo/dist/webapp/public"));
});

test("cover downloads are bounded and growing streams are pull-driven and cancellable", () => {
  const id3 = source("webapp/src/server/id3.ts");
  expect(id3).toContain("MAX_COVER_BYTES");
  expect(id3).toContain("response.body.getReader()");
  const growing = source("webapp/src/server/growing-file.ts");
  expect(growing).toContain("async pull(controller)");
  expect(growing).toContain("cancel()");
  expect(growing).toContain("MAX_CHUNK_BYTES");
});

test("download-all archive stream handles cancellation and finalize failures", () => {
  const routes = source("webapp/src/server/routes.ts");
  expect(routes).toContain("cancel()");
  expect(routes).toMatch(/archive\.finalize\(\).*catch/s);
  expect(routes).toContain("desiredSize");
});
