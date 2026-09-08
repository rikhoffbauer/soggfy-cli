import { expect, test } from "bun:test";
import { getHelpTopic, renderMarkdownForTerminal, listHelpTopics } from "../src/core/help";

const sample = `---
title: Sample
---
# Sample heading

Use **bold** and \`code\` with [the docs](https://example.com).

\`\`\`sh
soggfy download track > song.mp3
\`\`\`
`;

test("terminal renderer removes site-only markdown while preserving useful text", () => {
  const rendered = renderMarkdownForTerminal(sample, false);
  expect(rendered).not.toContain("title: Sample");
  expect(rendered).not.toContain("# Sample heading");
  expect(rendered).toContain("Sample heading");
  expect(rendered).toContain("bold");
  expect(rendered).toContain("`code`");
  expect(rendered).toContain("the docs (https://example.com)");
  expect(rendered).toContain("  soggfy download track > song.mp3");
});

test("command help is loaded from canonical Markdown topics", () => {
  const download = getHelpTopic("download");
  const streamAlias = getHelpTopic("stream");
  const search = getHelpTopic("search");
  const daemon = getHelpTopic("daemon");
  const lyrics = getHelpTopic("lyrics");
  expect(download).toContain("soggfy download");
  expect(streamAlias).toBe(download);
  expect(search).toContain("soggfy search");
  expect(daemon).toContain("web UI/API");
  expect(lyrics).toContain("soggfy lyrics");
  expect(getHelpTopic("web")).toBeNull();
  expect(getHelpTopic("webapp")).toBeNull();
});

test("help topic index includes commands and practical guides", () => {
  const topics = listHelpTopics();
  for (const topic of ["download", "search", "lyrics", "auth", "daemon", "scripting", "configuration", "troubleshooting"]) {
    expect(topics).toContain(topic);
  }
});
