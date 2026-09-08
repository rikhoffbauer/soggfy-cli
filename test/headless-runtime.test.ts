import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const nativePayload = readFileSync(join(root, "soggfy-macos/Payload/Main.mm"), "utf8");
const installSource = readFileSync(join(root, "src/commands/install.ts"), "utf8");
const setupSource = readFileSync(join(root, "setup.sh"), "utf8");

test("patched Spotify is prepared as a background-only macOS app", () => {
  expect(installSource).toContain("LSBackgroundOnly");
  expect(setupSource).toContain("LSBackgroundOnly");
});

test("hidden Spotify uses prohibited activation and suppresses primitive window ordering", () => {
  expect(nativePayload).toContain("NSApplicationActivationPolicyProhibited");
  expect(nativePayload).toContain('sel_registerName("orderWindow:relativeTo:")');
  expect(nativePayload).toContain("my_orderWindow");
  expect(nativePayload).toContain("NSWindowOut");
});
