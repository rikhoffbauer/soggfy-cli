import { expect, test } from "bun:test";
import { parseSearchArgs, formatSearchResults } from "../src/commands/search";

const results = [
  { id: "t1", uri: "spotify:track:t1", type: "track" as const, name: "Song", subtitle: "Artist" },
  { id: "a1", uri: "spotify:artist:a1", type: "artist" as const, name: "Artist", subtitle: "Artist" },
];

test("search parses a multi-word query and options", () => {
  expect(parseSearchArgs(["--type", "track", "--limit", "7", "rick", "astley"])).toEqual({
    query: "rick astley",
    types: ["track"],
    limit: 7,
    json: false,
  });
});

test("search supports JSON and defaults to all result types", () => {
  const parsed = parseSearchArgs(["--json", "needle"]);
  expect(parsed.query).toBe("needle");
  expect(parsed.types).toEqual(["track", "album", "artist", "playlist"]);
  expect(parsed.limit).toBe(10);
  expect(parsed.json).toBe(true);
  expect(JSON.parse(formatSearchResults(results, true))).toEqual(results);
});

test("search rejects invalid arguments", () => {
  expect(() => parseSearchArgs([])).toThrow("Search query is required");
  expect(parseSearchArgs(["--type", "album", "x"]).types).toEqual(["album"]);
  expect(() => parseSearchArgs(["--type", "episode", "x"])).toThrow("Unsupported search type: episode");
  expect(() => parseSearchArgs(["--limit", "wat", "x"])).toThrow("--limit requires an integer");
  expect(() => parseSearchArgs(["--wat", "x"])).toThrow("Unknown search option: --wat");
});

test("human search output keeps URI and secondary text visible", () => {
  const output = formatSearchResults(results, false);
  expect(output).toContain("TRACK");
  expect(output).toContain("Song");
  expect(output).toContain("Artist");
  expect(output).toContain("spotify:track:t1");
});
