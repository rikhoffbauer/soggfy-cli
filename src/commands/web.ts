import { daemonCommand } from "./daemon";

export interface WebServerOptions {
  host?: string;
  port?: number;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("--port must be an integer");
  const port = Number.parseInt(value, 10);
  if (port < 1 || port > 65535) throw new Error("--port must be between 1 and 65535");
  return port;
}

export function parseWebServerOptions(args: string[]): WebServerOptions {
  const options: WebServerOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--host") {
      options.host = requireValue(args, i, arg);
      i++;
    } else if (arg === "--port") {
      options.port = parsePort(requireValue(args, i, arg));
      i++;
    } else {
      throw new Error(`Unknown web option: ${arg}`);
    }
  }
  return options;
}

export async function webCommand(args: string[]): Promise<void> {
  const options = parseWebServerOptions(args);
  if (options.host) process.env.SOGGFY_HOST = options.host;
  if (options.port) process.env.SOGGFY_PORT = String(options.port);
  await daemonCommand(["start"]);
  const host = process.env.SOGGFY_HOST || "127.0.0.1";
  const port = process.env.SOGGFY_PORT || "8085";
  const healthHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const healthUrl = `http://${healthHost}:${port}/api/health`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        process.stderr.write(`Web UI: http://${host}:${port}\n`);
        return;
      }
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error(`Daemon is running but the web server did not become ready at ${healthUrl}`);
}
