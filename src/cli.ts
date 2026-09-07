#!/usr/bin/env bun

import { log } from "./core/log";

const VERSION = "1.0.0";

function printUsage(): void {
  console.error(`
${"\x1b[1m\x1b[36m"}soggfy${"\x1b[0m"} v${VERSION} — Spotify audio capture CLI for macOS

${"\x1b[1m"}USAGE${"\x1b[0m"}
  soggfy <command> [options]

${"\x1b[1m"}COMMANDS${"\x1b[0m"}
  stream <track>     Capture audio and stream to stdout or file
  daemon <action>    Manage background Spotify daemon (start|stop|status|restart|logs)
  install            Download dependencies and patch Spotify
  auth <action>      Manage authentication (login|logout|status|export|import)
  fingerprint <file> Generate audio fingerprint using fpcalc -length 240 -raw -plain

${"\x1b[1m"}EXAMPLES${"\x1b[0m"}
  soggfy install
  soggfy auth login
  soggfy daemon start
  soggfy stream 4PTG3Z6ehGkBFwjybzWkR8 > song.mp3
  soggfy stream -o song.flac https://open.spotify.com/track/...
  soggfy stream --format wav spotify:track:... | ffplay -
  soggfy auth export backup.json
  soggfy auth import backup.json

${"\x1b[1m"}OPTIONS${"\x1b[0m"}
  --help, -h         Show help for any command
  --version, -v      Show version
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    process.exit(0);
  }

  const subArgs = args.slice(1);

  switch (command) {
    case "stream": {
      const { streamCommand } = await import("./commands/stream");
      await streamCommand(subArgs);
      break;
    }
    case "daemon": {
      const { daemonCommand } = await import("./commands/daemon");
      await daemonCommand(subArgs);
      break;
    }
    case "install": {
      const { installCommand } = await import("./commands/install");
      await installCommand(subArgs);
      break;
    }
    case "auth": {
      const { authCommand } = await import("./commands/auth");
      await authCommand(subArgs);
      break;
    }
    case "fingerprint": {
      const { fingerprintCommand } = await import("./commands/fingerprint");
      await fingerprintCommand(subArgs);
      break;
    }
    default:
      log.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  log.error(err.message || String(err));
  process.exit(1);
});
