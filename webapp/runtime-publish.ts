import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";

export async function publishRuntimeDirectory(
  stagingDir: string,
  outdir: string,
  versionName: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9._-]+$/.test(versionName)) {
    throw new Error(`Invalid web runtime version name: ${versionName}`);
  }

  const versionsDir = join(outdir, "versions");
  const versionDir = join(versionsDir, versionName);
  await mkdir(versionsDir, { recursive: true });
  await rename(stagingDir, versionDir);

  const serverPath = join(outdir, "server.js");
  const pointerTemp = join(outdir, `.server-${randomUUID()}`);
  let published = false;
  try {
    await symlink(join("versions", versionName, "server.js"), pointerTemp);
    await rename(pointerTemp, serverPath);
    published = true;
  } finally {
    await rm(pointerTemp, { force: true }).catch(() => undefined);
    if (!published) {
      await rm(versionDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
