import { getHelpTopic, listHelpTopics, renderMarkdownForTerminal } from "../core/help";

export async function helpCommand(args: string[]): Promise<void> {
  const topic = args[0];
  if (!topic) {
    process.stderr.write(`Available help topics:\n  ${listHelpTopics().join("\n  ")}\n`);
    return;
  }
  const markdown = getHelpTopic(topic);
  if (!markdown) {
    throw new Error(`Unknown help topic: ${topic}. Available: ${listHelpTopics().join(", ")}`);
  }
  process.stderr.write(`${renderMarkdownForTerminal(markdown)}\n`);
}
