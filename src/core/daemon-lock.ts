import { closeSync, openSync, unlinkSync, writeFileSync } from "fs";

export interface DaemonStartLock {
  release(): void;
}

export function acquireDaemonStartLock(path: string): DaemonStartLock {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error: any) {
    if (error?.code === "EEXIST") {
      throw new Error(`Daemon start already in progress: ${path}`);
    }
    throw error;
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
