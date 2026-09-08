import downloadHelp from "../../docs/cli/download.md" with { type: "text" };
import searchHelp from "../../docs/cli/search.md" with { type: "text" };
import lyricsHelp from "../../docs/cli/lyrics.md" with { type: "text" };
import authHelp from "../../docs/cli/auth.md" with { type: "text" };
import daemonHelp from "../../docs/cli/daemon.md" with { type: "text" };
import installHelp from "../../docs/cli/install.md" with { type: "text" };
import fingerprintHelp from "../../docs/cli/fingerprint.md" with { type: "text" };
import scriptingHelp from "../../docs/guides/scripting.md" with { type: "text" };
import configurationHelp from "../../docs/guides/configuration.md" with { type: "text" };
import formatsHelp from "../../docs/guides/formats.md" with { type: "text" };
import troubleshootingHelp from "../../docs/guides/troubleshooting.md" with { type: "text" };

const TOPICS: Readonly<Record<string, string>> = {
  download: downloadHelp,
  search: searchHelp,
  lyrics: lyricsHelp,
  auth: authHelp,
  daemon: daemonHelp,
  install: installHelp,
  fingerprint: fingerprintHelp,
  scripting: scriptingHelp,
  configuration: configurationHelp,
  formats: formatsHelp,
  troubleshooting: troubleshootingHelp,
};

export function listHelpTopics(): string[] {
  return Object.keys(TOPICS);
}

export function getHelpTopic(topic: string): string | null {
  const lower = topic.toLowerCase();
  const normalized = lower === "stream" ? "download" : lower;
  return TOPICS[normalized] ?? null;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");
}

export function renderMarkdownForTerminal(markdown: string, ansi = Boolean(process.stderr.isTTY)): string {
  const bold = (value: string) => ansi ? `\x1b[1m${value}\x1b[0m` : value;
  const dim = (value: string) => ansi ? `\x1b[2m${value}\x1b[0m` : value;
  const lines = stripFrontmatter(markdown).trim().split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    if (/^```/.test(raw.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(`  ${raw}`);
      continue;
    }
    const heading = raw.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      out.push(heading[1]?.length === 1 ? bold(heading[2]!) : bold(heading[2]!));
      continue;
    }
    let line = raw;
    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
    line = line.replace(/\*\*([^*]+)\*\*/g, (_, text: string) => bold(text));
    line = line.replace(/^>\s?/, ansi ? "│ " : "> ");
    if (line.startsWith("| ") && line.endsWith(" |")) line = dim(line);
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function printHelpTopic(topic: string): boolean {
  const markdown = getHelpTopic(topic);
  if (!markdown) return false;
  process.stderr.write(`${renderMarkdownForTerminal(markdown)}\n`);
  return true;
}
