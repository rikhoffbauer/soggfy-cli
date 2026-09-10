import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const setup = readFileSync(join(root, "setup.sh"), "utf8");
const install = readFileSync(join(root, "src/commands/install.ts"), "utf8");
const runtimeSetup = readFileSync(join(root, "webapp/src/server/runtime-setup.ts"), "utf8");

test("setup re-signs the completed app bundle after installing the payload", () => {
  const copyIndex = setup.indexOf('cp "$ROOT_DIR/soggfy-macos/build/libsoggfy.dylib"');
  const signIndex = setup.indexOf('bun "$ROOT_DIR/scripts/sign-spotify.ts" "$STAGED_APP"');
  expect(copyIndex).toBeGreaterThan(-1);
  expect(signIndex).toBeGreaterThan(copyIndex);
  expect(install).toContain("replaceDirectoryAtomically(stagedApp, PATCHED_APP)");
});

test("CLI installer re-signs the completed app bundle before verification", () => {
  const copyIndex = install.indexOf('run(["cp", dylibPath, destDylib]');
  const signIndex = install.indexOf('signSpotifyBundle(stagedApp)');
  expect(copyIndex).toBeGreaterThan(-1);
  expect(signIndex).toBeGreaterThan(copyIndex);
  expect(install).toContain("replaceDirectoryAtomically(stagedApp, PATCHED_APP)");
});


test("webapp payload refresh uses the shared signing implementation", () => {
  expect(runtimeSetup).toContain('signSpotifyBundle(appBundle)');
});
