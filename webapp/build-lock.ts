import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function withBuildPublishLock<T>(
  lockDir: string,
  operation: () => Promise<T>,
  { timeoutMs = 30_000, pollMs = 25 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for web runtime publish lock: ${lockDir}`);
      }
      await Bun.sleep(pollMs);
      continue;
    }

    try {
      await writeFile(join(lockDir, "owner"), `${process.pid}\n`, { mode: 0o600 });
    } catch (error) {
      await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    break;
  }

  try {
    return await operation();
  } finally {
    await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
