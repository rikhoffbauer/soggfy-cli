import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";

export interface DaemonStartLock {
  release(): void;
}

function lockOwnerIsAlive(path: string): boolean {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

function openStartLock(path: string): number {
  return openSync(path, "wx", 0o600);
}

export function acquireDaemonStartLock(path: string): DaemonStartLock {
  let fd: number;
  try {
    fd = openStartLock(path);
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    if (lockOwnerIsAlive(path)) throw new Error(`Daemon start already in progress: ${path}`);
    try { unlinkSync(path); } catch (unlinkError: any) {
      if (unlinkError?.code !== "ENOENT") throw unlinkError;
    }
    try {
      fd = openStartLock(path);
    } catch (retryError: any) {
      if (retryError?.code === "EEXIST") throw new Error(`Daemon start already in progress: ${path}`);
      throw retryError;
    }
  }
  writeFileSync(fd, `${process.pid}\n`);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try { closeSync(fd); } catch {}
      try { unlinkSync(path); } catch {}
    },
  };
}
