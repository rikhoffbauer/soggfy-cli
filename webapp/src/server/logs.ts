import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "fs";
import { join, relative } from "path";

export interface LogRoots {
  logDir: string;
  runtimeDir: string;
  profilesDir: string;
  payloadDir: string;
}

export interface LogSource {
  id: string;
  label: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  category: "daemon" | "historical" | "runtime" | "spotify" | "payload";
}

const LOG_FILE = /\.(?:log|err|out|stdout|stderr)$/i;
const PAYLOAD_LOG = /^payload-\d+\.log$/i;
const SPOTIFY_LOG = /^spotify\.(?:log|err)$/i;
const MAX_TAIL_BYTES = 2 * 1024 * 1024;

function shouldInclude(prefix: string, name: string): boolean {
  if (!prefix) return LOG_FILE.test(name);
  if (prefix === "profiles") return SPOTIFY_LOG.test(name) || name === "chrome_debug.log";
  return PAYLOAD_LOG.test(name) || SPOTIFY_LOG.test(name) || name === "chrome_debug.log";
}

function categoryFor(prefix: string, label: string): LogSource["category"] {
  if (!prefix && label === "daemon.log") return "daemon";
  if (!prefix) return "historical";
  if (prefix === "runtime") return "runtime";
  if (prefix === "profiles") return "spotify";
  return "payload";
}

function discover(base: string, prefix: string): LogSource[] {
  const found: LogSource[] = [];
  const visit = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || !shouldInclude(prefix, entry.name)) continue;
      let stat;
      try { stat = statSync(path); } catch { continue; }
      const rel = relative(base, path).split("\\").join("/");
      const label = prefix ? `${prefix}/${rel}` : rel;
      found.push({
        id: Buffer.from(path).toString("base64url"),
        label,
        path,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        category: categoryFor(prefix, label),
      });
    }
  };
  visit(base);
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

export function listLogSources(roots: LogRoots): LogSource[] {
  return [
    ...discover(roots.logDir, ""),
    ...discover(roots.runtimeDir, "runtime"),
    ...discover(roots.profilesDir, "profiles"),
    ...discover(roots.payloadDir, "payload"),
  ];
}

export function decodeLogTail(
  buffer: Buffer,
  options: { bytesRead: number; start: number; lineLimit: number; previousByte?: number },
) {
  const text = buffer.subarray(0, Math.max(0, options.bytesRead)).toString("utf8");
  let lines = text.split(/\r?\n/);
  const startsMidLine = options.start > 0 && options.previousByte !== 0x0a && options.previousByte !== 0x0d;
  if (startsMidLine) lines = lines.slice(1);
  if (lines.at(-1) === "") lines.pop();
  const truncated = options.start > 0 || lines.length > options.lineLimit;
  if (lines.length > options.lineLimit) lines = lines.slice(-options.lineLimit);
  return { lines, truncated };
}

export function readLogTail(source: LogSource, maxLines = 500) {
  const lineLimit = Math.max(1, Math.min(5000, Math.floor(maxLines)));
  const fd = openSync(source.path, "r");
  try {
    const stat = fstatSync(fd);
    const start = Math.max(0, stat.size - MAX_TAIL_BYTES);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    const bytesRead = length > 0 ? readSync(fd, buffer, 0, length, start) : 0;
    let previousByte: number | undefined;
    if (start > 0) {
      const previous = Buffer.alloc(1);
      if (readSync(fd, previous, 0, 1, start - 1) === 1) previousByte = previous[0];
    }
    const decoded = decodeLogTail(buffer, { bytesRead, start, lineLimit, previousByte });
    return {
      source: { ...source, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() },
      ...decoded,
    };
  } finally {
    closeSync(fd);
  }
}
