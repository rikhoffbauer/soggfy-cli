import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { formatCommandList } from "../src/core/commands";

const root = join(import.meta.dir, "..");
const cli = readFileSync(join(root, "src/cli.ts"), "utf8");
const web = readFileSync(join(root, "webapp/src/index.ts"), "utf8");

test("lyrics is a first-class CLI command", () => {
  expect(formatCommandList()).toContain("lyrics <track>");
  expect(cli).toContain('case "lyrics"');
});

test("daemon API exposes normalized Spotify lyrics", () => {
  expect(web).toContain('"/api/lyrics"');
  expect(web).toContain("fetchSpotifyLyrics(trackId)");
  expect(web).toContain('source: "spotify"');
});
