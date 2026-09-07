import re

with open("/Volumes/Repositories/soggfy-cli/src/commands/daemon.ts", "r") as f:
    content = f.read()

# Add import indexHtml at the top
content = content.replace('import { ping } from "../core/ipc";', 'import { ping } from "../core/ipc";\n\n// @ts-ignore\nimport indexHtml from "../web/index.html";')

# Add server block inside daemonRun()
server_block = """
  // >>> ADD THE HTTP SERVER HERE <<<
  const server = Bun.serve({
    port: 8080,
    routes: {
      "/": indexHtml,
      "/api/status": {
        GET: async () => {
          const ok = await ping(IPC_SOCKET);
          return new Response(
            JSON.stringify({ pid: process.pid, ipcResponsive: ok, savePath: SAVE_PATH }),
            { headers: { "Content-Type": "application/json" } }
          );
        },
      },
      "/api/stream": {
        POST: async (req) => {
          try {
            const body = await req.json();
            if (body.track) {
              const cliPath = `${__dirname}/../cli.ts`;
              // Spawn soggfy stream in the background
              Bun.spawn(["bun", "run", cliPath, "stream", body.track], {
                stdout: "inherit",
                stderr: "inherit",
              });
            }
            return new Response(JSON.stringify({ success: true, track: body.track }));
          } catch (err: any) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });
          }
        },
      },
    },
    development: { hmr: true, console: true },
  });

  appendLog(`Web UI and API server listening on http://localhost:${server.port}`);
  // >>> END HTTP SERVER ADDITION <<<
"""

content = content.replace('appendLog("Spotify instance ready.");\n  } catch (e: any) {', 'appendLog("Spotify instance ready.");\n  } catch (e: any) {')
# Wait, let's just do a string replacement on the exact location
search_target = """
  try {
    await instance.start();
    appendLog("Spotify instance ready.");
  } catch (e: any) {
    appendLog(`Failed to start Spotify instance: ${e.message}`);
    try { unlinkSync(PID_FILE); } catch {}
    process.exit(1);
  }"""

content = content.replace(search_target, search_target + "\n" + server_block)

with open("/Volumes/Repositories/soggfy-cli/src/commands/daemon.ts", "w") as f:
    f.write(content)

