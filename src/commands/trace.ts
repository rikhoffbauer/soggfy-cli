import { replayCaptureTraceFile } from "../core/capture-trace";

export function parseTraceArgs(args: string[]): { action: "replay"; path: string } {
  const [action, path, ...rest] = args;
  if (action !== "replay" || !path || rest.length > 0) {
    throw new Error("Usage: soggfy trace replay <capture.jsonl>");
  }
  return { action, path };
}

export async function traceCommand(args: string[]): Promise<void> {
  const { path } = parseTraceArgs(args);
  const summary = replayCaptureTraceFile(path);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
