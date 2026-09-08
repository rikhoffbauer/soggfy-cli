import { expect, test } from "bun:test";
import { parseStreamArgs } from "../src/commands/stream";

test("parseStreamArgs rejects unsupported formats", () => {
  expect(() => parseStreamArgs(["--format", "aac", "track"])).toThrow(
    "Unsupported output format: aac",
  );
});

test("parseStreamArgs rejects missing option values", () => {
  expect(() => parseStreamArgs(["--output"])).toThrow("--output requires an output path");
  expect(() => parseStreamArgs(["--format"])).toThrow("--format requires an output format");
});

test("parseStreamArgs rejects unknown flags", () => {
  expect(() => parseStreamArgs(["--wat", "track"])).toThrow("Unknown stream option: --wat");
});

test("parseStreamArgs accepts valid options and infers extension", () => {
  const parsed = parseStreamArgs(["--output", "song.flac", "track"]);
  expect(parsed.inputs).toEqual(["track"]);
  expect(parsed.opts.format).toBe("flac");
  expect(parsed.opts.output).toBe("song.flac");
});
