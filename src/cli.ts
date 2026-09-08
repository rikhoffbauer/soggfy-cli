#!/usr/bin/env bun

import { log } from "./core/log";
import { formatCommandList } from "./core/commands";
import packageJson from "../package.json";

const VERSION = packageJson.version;

function printUsage(): void {
  console.error(`
${"\x1b[1m\x1b[36m"}soggfy${"\x1b[0m"} v${VERSION} — Spotify audio capture CLI for macOS

${"\x1b[1m"}USAGE${"\x1b[0m"}
  soggfy <command> [options]

${"\x1b[1m"}COMMANDS${"\x1b[0m"}
${formatCommandList()}

${"\x1b[1m"}EXAMPLES${"\x1b[0m"}
  soggfy install
  soggfy auth login
  soggfy daemon start
  soggfy download 4PTG3Z6ehGkBFwjybzWkR8 > song.mp3
  soggfy download -o song.flac https://open.spotify.com/track/...
  soggfy download --format wav spotify:track:... | ffplay -

${"\x1b[1m"}OPTIONS${"\x1b[0m"}
  --help, -h         Show help
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

  if (subArgs.includes("--help") || subArgs.includes("-h")) {
    const { printHelpTopic } = await import("./core/help");
    if (printHelpTopic(command)) return;
  }

  switch (command) {
    case "help": {
      const { helpCommand } = await import("./commands/help");
      await helpCommand(subArgs);
      break;
    }
    case "download": {
      const { downloadCommand } = await import("./commands/download");
      await downloadCommand(subArgs);
      break;
    }
    case "stream": {
      console.error("warning: 'soggfy stream' is deprecated; use 'soggfy download' instead");
      const { downloadCommand } = await import("./commands/download");
      await downloadCommand(subArgs);
      break;
    }
    case "search": {
      const { searchCommand } = await import("./commands/search");
      await searchCommand(subArgs);
      break;
    }
    case "lyrics": {
      const { lyricsCommand } = await import("./commands/lyrics");
      await lyricsCommand(subArgs);
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
