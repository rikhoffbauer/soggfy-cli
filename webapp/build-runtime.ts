import tailwind from "bun-plugin-tailwind";
import { rename, rm } from "node:fs/promises";
import path from "node:path";

const outdir = path.resolve(import.meta.dir, "../dist/webapp");
await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "src/index.ts")],
  outdir,
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

const serverEntry = path.join(outdir, "index.js");
const packagedEntry = path.join(outdir, "server.js");
await rename(serverEntry, packagedEntry);
console.log(`Bundled web runtime: ${packagedEntry}`);
