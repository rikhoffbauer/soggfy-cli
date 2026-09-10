import { closeSync, constants, ftruncateSync, mkdirSync, openSync, writeFileSync } from "fs";
import { dirname } from "path";
import { AUTH_DIR } from "./paths";

export const AUTH_STATE_LOCK = `${AUTH_DIR}/.state.lock`;

export interface AuthStateLock {
  release(): void;
}

// Darwin sys/fcntl.h: acquire the advisory lock as part of open(), before
// publishing any PID. Keep the inode in place; close/process exit releases it.
const O_EXLOCK = 0x20;

export function acquireAuthStateLock(path = AUTH_STATE_LOCK): AuthStateLock {
  if (process.platform !== "darwin") throw new Error("Auth state locking requires macOS");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let fd: number;
  try {
    fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NONBLOCK | O_EXLOCK, 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "EAGAIN" || error.code === "EWOULDBLOCK")) {
      throw new Error(`Auth state is busy: ${path}`);
    }
    throw error;
  }
  try {
    ftruncateSync(fd, 0);
    writeFileSync(fd, `${process.pid}\n`);
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      closeSync(fd);
    },
  };
}
