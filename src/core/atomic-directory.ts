import { existsSync, renameSync, rmSync } from "fs";

export interface AtomicDirectoryOptions {
  cleanupBackup?: (path: string) => void;
}

export function replaceDirectoryAtomically(
  stagedPath: string,
  targetPath: string,
  options: AtomicDirectoryOptions = {},
): void {
  const backupPath = `${targetPath}.backup`;
  if (existsSync(backupPath)) {
    throw new Error(`Refusing atomic replacement with stale backup present: ${backupPath}`);
  }

  const hadTarget = existsSync(targetPath);
  if (hadTarget) renameSync(targetPath, backupPath);

  try {
    renameSync(stagedPath, targetPath);
  } catch (error) {
    try {
      if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
      if (hadTarget && existsSync(backupPath)) renameSync(backupPath, targetPath);
    } catch {}
    throw error;
  }

  if (hadTarget) {
    try {
      if (options.cleanupBackup) options.cleanupBackup(backupPath);
      else rmSync(backupPath, { recursive: true, force: true });
    } catch {
      // The replacement is already committed. Leave the backup for manual cleanup.
    }
  }
}
