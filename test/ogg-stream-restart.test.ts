import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("premature Ogg EOS discards the aborted prefix before replacement stream", () => {
  const source = readFileSync(join(import.meta.dir, "../soggfy-macos/Payload/DecodeHook.mm"), "utf8");
  const start = source.indexOf("if (is_eos)");
  const branch = source.slice(start, source.indexOf("return ret;", start));
  expect(branch).toContain("state.RestartOggCapture(track_id)");
  expect(branch).toContain("Discarded aborted stream");
  expect(branch).not.toContain("state.ReceiveOggData(track_id");
});
