import tailwind from "bun-plugin-tailwind";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { withBuildPublishLock } from "./build-lock";
import { publishRuntimeDirectory } from "./runtime-publish";

const distDir = path.resolve(import.meta.dir, "../dist");
const outdir = path.join(distDir, "webapp");
const nonce = `${process.pid}-${Date.now()}`;
const stagingDir = path.join(distDir, `.webapp-build-${nonce}`);
const publicDir = path.join(stagingDir, "public");

await mkdir(distDir, { recursive: true });
const publishLockDir = path.join(distDir, ".webapp-publish.lock");

function requireSuccessfulBuild(result: Bun.BuildOutput, label: string): void {
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  throw new Error(`Failed to build ${label}`);
}

await withBuildPublishLock(publishLockDir, async () => {
  await rm(stagingDir, { recursive: true, force: true });
  try {
    const browserResult = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "src/index.html")],
      outdir: publicDir,
      plugins: [tailwind],
      minify: true,
      target: "browser",
      sourcemap: "linked",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
    });
    requireSuccessfulBuild(browserResult, "web UI");

    const serverResult = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "src/runtime-entry.ts")],
      outdir: stagingDir,
      minify: true,
      target: "bun",
      sourcemap: "linked",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
    });
    requireSuccessfulBuild(serverResult, "web runtime server");

    await rename(path.join(stagingDir, "runtime-entry.js"), path.join(stagingDir, "server.js"));
    await publishRuntimeDirectory(stagingDir, outdir, nonce);
    console.log(`Bundled web runtime: ${path.join(outdir, "server.js")}`);
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
