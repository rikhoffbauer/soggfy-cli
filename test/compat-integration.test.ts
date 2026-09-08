import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { formatCommandList } from "../src/core/commands";
import { getHelpTopic, listHelpTopics } from "../src/core/help";

const root = join(import.meta.dir, "..");
const cli = readFileSync(join(root, "src/cli.ts"), "utf8");

test("compat is a first-class CLI command", () => {
  expect(formatCommandList()).toContain("compat <action>");
  expect(cli).toContain('case "compat"');
});

test("compat has canonical embedded Markdown help", () => {
  expect(listHelpTopics()).toContain("compat");
  expect(getHelpTopic("compat")).toContain("soggfy compat probe");
  expect(getHelpTopic("compat")).toContain("Unrecorded versions");
});
