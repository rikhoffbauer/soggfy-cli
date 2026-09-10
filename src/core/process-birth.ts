import { dlopen, FFIType, ptr } from "bun:ffi";

const PROC_PIDTBSDINFO = 3;
const PROC_BSDINFO_SIZE = 136;
const START_SEC_OFFSET = 120;
const START_USEC_OFFSET = 128;

let libproc: ReturnType<typeof dlopen> | null | undefined;

function getLibproc() {
  if (process.platform !== "darwin") return null;
  if (libproc !== undefined) return libproc;
  try {
    libproc = dlopen("/usr/lib/libproc.dylib", {
      proc_pidinfo: {
        args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
    });
  } catch {
    libproc = null;
  }
  return libproc;
}

export function readKernelProcessBirthId(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const library = getLibproc();
  if (!library) return null;
  const buffer = new Uint8Array(PROC_BSDINFO_SIZE);
  const procPidInfo = library.symbols.proc_pidinfo as unknown as (
    pid: number,
    flavor: number,
    arg: bigint,
    buffer: ReturnType<typeof ptr>,
    bufferSize: number,
  ) => number;
  const bytes = procPidInfo(pid, PROC_PIDTBSDINFO, 0n, ptr(buffer), buffer.byteLength);
  if (bytes !== PROC_BSDINFO_SIZE) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const seconds = view.getBigUint64(START_SEC_OFFSET, true);
  const microseconds = view.getBigUint64(START_USEC_OFFSET, true);
  if (seconds === 0n || microseconds >= 1_000_000n) return null;
  return `${seconds}:${microseconds.toString().padStart(6, "0")}`;
}
