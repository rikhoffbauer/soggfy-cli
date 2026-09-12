import { closeSync, existsSync, openSync, readSync, statSync } from "fs";
import { CORS_HEADERS } from "./http";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const MAX_CHUNK_BYTES = 256 * 1024;

export interface GrowingFileOptions {
  getPath: () => string | undefined | null;
  getState: () => string;
  signal?: AbortSignal;
  startupTimeoutMs?: number;
  pollMs?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function readRange(path: string, offset: number, length: number): Uint8Array {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

export function streamGrowingFile(options: GrowingFileOptions): Response {
  const startupTimeoutMs = options.startupTimeoutMs ?? 20_000;
  const pollMs = options.pollMs ?? 100;
  const startedAt = Date.now();
  let activePath: string | null = null;
  let activeInode: number | bigint | null = null;
  let offset = 0;
  let cancelled = false;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (!closed && !cancelled) {
        if (options.signal?.aborted) {
          closed = true;
          controller.close();
          return;
        }

        const state = options.getState();
        const candidate = options.getPath();
        if (candidate && existsSync(candidate)) {
          const stat = statSync(candidate);
          if (stat.isFile() && stat.size > 0) {
            if (activePath === null) {
              activePath = candidate;
              activeInode = stat.ino;
            } else if (candidate !== activePath || stat.ino !== activeInode || stat.size < offset) {
              closed = true;
              controller.close();
              return;
            }

            if (stat.size > offset) {
              const chunk = readRange(candidate, offset, Math.min(MAX_CHUNK_BYTES, stat.size - offset));
              if (chunk.byteLength > 0) {
                offset += chunk.byteLength;
                controller.enqueue(chunk);
                return;
              }
            }
          }
        }

        if (TERMINAL_STATES.has(state) || (activePath === null && Date.now() - startedAt >= startupTimeoutMs)) {
          closed = true;
          controller.close();
          return;
        }
        await sleep(pollMs, options.signal);
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "audio/ogg",
      "Cache-Control": "no-store",
      "Accept-Ranges": "none",
    },
  });
}
