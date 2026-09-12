import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withBuildPublishLock } from "../webapp/build-lock";
import { publishRuntimeDirectory } from "../webapp/runtime-publish";

test("web runtime publication lock serializes concurrent publishers", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-web-build-lock-"));
  const lockDir = join(root, "publish.lock");
  let inside = 0;
  let maxInside = 0;

  const publish = () => withBuildPublishLock(lockDir, async () => {
    inside += 1;
    maxInside = Math.max(maxInside, inside);
    await Bun.sleep(50);
    inside -= 1;
  });

  try {
    await Promise.all([publish(), publish()]);
    expect(maxInside).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("stale web runtime locks fail closed instead of deleting an unowned lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-web-build-stale-lock-"));
  const lockDir = join(root, "publish.lock");
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, "owner"), "99999999\n");
  let ran = false;

  try {
    await expect(withBuildPublishLock(lockDir, async () => {
      ran = true;
    }, { timeoutMs: 15, pollMs: 1 })).rejects.toThrow("Timed out waiting for web runtime publish lock");
    expect(ran).toBe(false);
    expect(readFileSync(join(lockDir, "owner"), "utf8")).toBe("99999999\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct web runtime build and publication stay inside the publish-lock callback", () => {
  const source = readFileSync(join(import.meta.dir, "../webapp/build-runtime.ts"), "utf8");
  const lock = source.indexOf("await withBuildPublishLock(");
  const callbackEnd = source.lastIndexOf("});");
  const build = source.indexOf("Bun.build", lock);
  const publish = source.indexOf("publishRuntimeDirectory", build);
  expect(lock).toBeGreaterThan(-1);
  expect(callbackEnd).toBeGreaterThan(lock);
  expect(build).toBeGreaterThan(lock);
  expect(build).toBeLessThan(callbackEnd);
  expect(publish).toBeGreaterThan(build);
  expect(publish).toBeLessThan(callbackEnd);
});

test("build lock removes only its newly created directory when owner metadata cannot be written", () => {
  const source = readFileSync(join(import.meta.dir, "../webapp/build-lock.ts"), "utf8");
  const mkdir = source.indexOf("await mkdir(lockDir)");
  const write = source.indexOf('await writeFile(join(lockDir, "owner")', mkdir);
  const cleanup = source.indexOf("await rm(lockDir", write);
  const rethrow = source.indexOf("throw error", cleanup);
  expect(mkdir).toBeGreaterThan(-1);
  expect(write).toBeGreaterThan(mkdir);
  expect(cleanup).toBeGreaterThan(write);
  expect(rethrow).toBeGreaterThan(cleanup);
});

test("runtime publication atomically switches server.js to a complete immutable version", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-web-publish-"));
  const staging = join(root, "staging");
  const outdir = join(root, "out");
  mkdirSync(staging);
  mkdirSync(outdir);
  writeFileSync(join(outdir, "server.js"), "old-server");
  writeFileSync(join(outdir, "old-chunk.js"), "old-chunk");
  writeFileSync(join(staging, "server.js"), "new-server");
  writeFileSync(join(staging, "new-chunk.js"), "new-chunk");
  try {
    await publishRuntimeDirectory(staging, outdir, "build-v2");
    expect(readlinkSync(join(outdir, "server.js"))).toBe("versions/build-v2/server.js");
    expect(readFileSync(realpathSync(join(outdir, "server.js")), "utf8")).toBe("new-server");
    expect(readFileSync(join(outdir, "versions/build-v2/new-chunk.js"), "utf8")).toBe("new-chunk");
    expect(readFileSync(join(outdir, "old-chunk.js"), "utf8")).toBe("old-chunk");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed immutable-version publication leaves the existing server pointer unchanged", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-web-publish-fail-"));
  const staging = join(root, "staging");
  const outdir = join(root, "out");
  mkdirSync(staging);
  mkdirSync(join(outdir, "versions/build-v2"), { recursive: true });
  writeFileSync(join(outdir, "server.js"), "old-server");
  writeFileSync(join(outdir, "versions/build-v2/existing"), "occupied");
  writeFileSync(join(staging, "server.js"), "new-server");
  writeFileSync(join(staging, "new-chunk.js"), "new-chunk");
  try {
    await expect(publishRuntimeDirectory(staging, outdir, "build-v2")).rejects.toThrow();
    expect(readFileSync(join(outdir, "server.js"), "utf8")).toBe("old-server");
    expect(readFileSync(join(outdir, "versions/build-v2/existing"), "utf8")).toBe("occupied");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent runtime publications use collision-resistant temporary pointers", async () => {
  const root = mkdtempSync(join(tmpdir(), "soggfy-web-publish-concurrent-"));
  const outdir = join(root, "out");
  mkdirSync(outdir);
  writeFileSync(join(outdir, "server.js"), "old-server");
  const originalNow = Date.now;
  Date.now = () => 1234567890;
  try {
    const publish = async (version: string) => {
      const staging = join(root, `staging-${version}`);
      mkdirSync(staging);
      writeFileSync(join(staging, "server.js"), version);
      await publishRuntimeDirectory(staging, outdir, version);
    };
    await Promise.all([publish("build-a"), publish("build-b")]);
    expect(readFileSync(join(outdir, "versions/build-a/server.js"), "utf8")).toBe("build-a");
    expect(readFileSync(join(outdir, "versions/build-b/server.js"), "utf8")).toBe("build-b");
    expect(["build-a", "build-b"]).toContain(readFileSync(realpathSync(join(outdir, "server.js")), "utf8"));
  } finally {
    Date.now = originalNow;
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent direct web runtime builds both finish with a usable server", async () => {
  const repoRoot = join(import.meta.dir, "..");
  const launch = () => Bun.spawn(["bun", "run", "webapp/build-runtime.ts"], {
    cwd: repoRoot, stdout: "ignore", stderr: "pipe",
  });
  const first = launch();
  const second = launch();
  const [firstCode, secondCode] = await Promise.all([first.exited, second.exited]);
  if (firstCode !== 0 || secondCode !== 0) {
    const errors = await Promise.all([new Response(first.stderr).text(), new Response(second.stderr).text()]);
    throw new Error(`concurrent builds failed: ${firstCode}/${secondCode}\n${errors.join("\n")}`);
  }
  expect(existsSync(join(repoRoot, "dist/webapp/server.js"))).toBe(true);
});
