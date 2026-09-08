export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 8085;

export interface HttpConfig {
  host: string;
  port: number;
}

export function getHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const host = env.SOGGFY_HOST || DEFAULT_HTTP_HOST;
  const rawPort = env.SOGGFY_PORT;
  const port = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_HTTP_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid SOGGFY_PORT: ${rawPort}`);
  }
  return { host, port };
}

export function getHttpOrigin(config = getHttpConfig()): string {
  const connectHost = config.host === "0.0.0.0" || config.host === "::" ? DEFAULT_HTTP_HOST : config.host;
  const formattedHost = connectHost.includes(":") && !connectHost.startsWith("[")
    ? `[${connectHost}]`
    : connectHost;
  return `http://${formattedHost}:${config.port}`;
}
