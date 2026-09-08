export interface CommandDefinition {
  name: string;
  usage?: string;
  description: string;
  aliases?: readonly string[];
}

export const COMMANDS: readonly CommandDefinition[] = [
  { name: "download", usage: "<track>", description: "Capture Spotify audio to stdout, a file, or a directory", aliases: ["stream"] },
  { name: "search", usage: "<query>", description: "Search Spotify tracks, artists, and playlists" },
  { name: "daemon", usage: "<action>", description: "Manage the background Spotify capture daemon" },
  { name: "install", description: "Install dependencies and prepare the patched Spotify app" },
  { name: "auth", usage: "<action>", description: "Manage Spotify authentication state" },
  { name: "fingerprint", usage: "<file>", description: "Generate a Chromaprint audio fingerprint" },
  { name: "help", usage: "[topic]", description: "Read the embedded Markdown documentation" },
];

export function formatCommandList(): string {
  const width = Math.max(...COMMANDS.map((command) => `${command.name}${command.usage ? ` ${command.usage}` : ""}`.length));
  return COMMANDS.map((command) => {
    const label = `${command.name}${command.usage ? ` ${command.usage}` : ""}`;
    return `  ${label.padEnd(width)}  ${command.description}`;
  }).join("\n");
}
