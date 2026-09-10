import { closeSync, existsSync, openSync, readSync, statSync } from "fs";
import { CORS_HEADERS } from "./http";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let activePath: string | null = null;
      let activeInode: number | bigint | null = null;
      let offset = 0;

      while (true) {
        if (options.signal?.aborted) {
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
            } else if (
              candidate !== activePath ||
              stat.ino !== activeInode ||
              stat.size < offset
            ) {
              controller.close();
              return;
            }

            if (stat.size > offset) {
              const chunk = readRange(candidate, offset, stat.size - offset);
              if (chunk.byteLength > 0) {
                offset += chunk.byteLength;
                controller.enqueue(chunk);
              }
            }
          }
        }

        if (TERMINAL_STATES.has(state)) {
          controller.close();
          return;
        }

        if (activePath === null && Date.now() - startedAt >= startupTimeoutMs) {
          controller.close();
          return;
        }

        await sleep(pollMs, options.signal);
      }
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
