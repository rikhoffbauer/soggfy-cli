import tailwind from "bun-plugin-tailwind";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { withBuildPublishLock } from "./build-lock";
import { publishRuntimeDirectory } from "./runtime-publish";

const distDir = path.resolve(import.meta.dir, "../dist");
const outdir = path.join(distDir, "webapp");
const nonce = `${process.pid}-${Date.now()}`;
const stagingDir = path.join(distDir, `.webapp-build-${nonce}`);

await mkdir(distDir, { recursive: true });
const publishLockDir = path.join(distDir, ".webapp-publish.lock");

await withBuildPublishLock(publishLockDir, async () => {
  await rm(stagingDir, { recursive: true, force: true });
  try {
    const result = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "src/index.ts")],
      outdir: stagingDir,
      plugins: [tailwind],
      minify: true,
      target: "bun",
      sourcemap: "linked",
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
    });

    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error("Failed to build bundled web runtime");
    }

    const serverEntry = path.join(stagingDir, "index.js");
    await rename(serverEntry, path.join(stagingDir, "server.js"));

    await publishRuntimeDirectory(stagingDir, outdir, nonce);
    console.log(`Bundled web runtime: ${path.join(outdir, "server.js")}`);
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
