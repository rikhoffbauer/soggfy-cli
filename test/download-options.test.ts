import { expect, test } from "bun:test";
import { parseDownloadArgs } from "../src/commands/download";

test("parseDownloadArgs rejects unsupported formats", () => {
  expect(() => parseDownloadArgs(["--format", "aac", "track"])).toThrow(
    "Unsupported output format: aac",
  );
});

test("parseDownloadArgs rejects missing option values", () => {
  expect(() => parseDownloadArgs(["--output"])).toThrow("--output requires an output path");
  expect(() => parseDownloadArgs(["--format"])).toThrow("--format requires an output format");
});

test("parseDownloadArgs rejects unknown flags", () => {
  expect(() => parseDownloadArgs(["--wat", "track"])).toThrow("Unknown download option: --wat");
});

test("parseDownloadArgs accepts valid options and infers extension", () => {
  const parsed = parseDownloadArgs(["--output", "song.flac", "track"]);
  expect(parsed.inputs).toEqual(["track"]);
  expect(parsed.opts.format).toBe("flac");
  expect(parsed.opts.output).toBe("song.flac");
});
