import { mkdir, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

async function collectFiles(root: string, relativeDir = ""): Promise<string[]> {
  const entries = await readdir(join(root, relativeDir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

export async function publishRuntimeDirectory(stagingDir: string, outdir: string): Promise<void> {
  await mkdir(outdir, { recursive: true });
  const files = await collectFiles(stagingDir);
  files.sort((left, right) => {
    const leftServer = left === "server.js" ? 1 : 0;
    const rightServer = right === "server.js" ? 1 : 0;
    return leftServer - rightServer || left.localeCompare(right);
  });

  for (const relativePath of files) {
    const destination = join(outdir, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await rename(join(stagingDir, relativePath), destination);
  }
}
