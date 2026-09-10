import { existsSync, renameSync, rmSync } from "fs";

export function replaceDirectoryAtomically(stagedPath: string, targetPath: string): void {
  const backupPath = `${targetPath}.backup`;
  if (existsSync(backupPath)) {
    throw new Error(`Refusing atomic replacement with stale backup present: ${backupPath}`);
  }

  const hadTarget = existsSync(targetPath);
  if (hadTarget) renameSync(targetPath, backupPath);

  try {
    renameSync(stagedPath, targetPath);
    if (hadTarget) rmSync(backupPath, { recursive: true, force: true });
  } catch (error) {
    try {
      if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
      if (hadTarget && existsSync(backupPath)) renameSync(backupPath, targetPath);
    } catch {}
    throw error;
  }
}
