import { createConnection } from "net";

export async function sendIPC(
  socketPath: string,
  command: string,
  { retries = 3, timeoutMs = 3000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const client = createConnection(socketPath);
        let response = "";
        const timer = setTimeout(() => {
          client.destroy();
          reject(new Error(`IPC timeout for '${command}'`));
        }, timeoutMs);
        client.on("connect", () => client.write(command));
        client.on("data", (data) => (response += data.toString()));
        client.on("end", () => {
          clearTimeout(timer);
          resolve(response.trim());
        });
        client.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await Bun.sleep(150 + attempt * 250);
    }
  }
  throw new Error("unreachable IPC retry fallthrough");
}

export async function ping(socketPath: string): Promise<boolean> {
  try {
    const result = await sendIPC(socketPath, "ping", { retries: 1, timeoutMs: 1000 });
    return result === "pong";
  } catch {
    return false;
  }
}
