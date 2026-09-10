import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const setup = readFileSync(join(root, "setup.sh"), "utf8");
const install = readFileSync(join(root, "src/commands/install.ts"), "utf8");
const runtimeSetup = readFileSync(join(root, "webapp/src/server/runtime-setup.ts"), "utf8");

test("setup re-signs the completed app bundle after installing the payload", () => {
  const copyIndex = setup.indexOf('cp "$ROOT_DIR/soggfy-macos/build/libsoggfy.dylib"');
  const signIndex = setup.indexOf('codesign -f -s - --deep "$STAGED_APP"');
  const verifyIndex = setup.indexOf('codesign --verify --deep --strict "$STAGED_APP"');
  expect(copyIndex).toBeGreaterThan(-1);
  expect(signIndex).toBeGreaterThan(copyIndex);
  expect(verifyIndex).toBeGreaterThan(signIndex);
  expect(install).toContain("replaceDirectoryAtomically(stagedApp, PATCHED_APP)");
});

test("CLI installer re-signs the completed app bundle before verification", () => {
  const copyIndex = install.indexOf('run(["cp", dylibPath, destDylib]');
  const signIndex = install.indexOf('run(["codesign", "-f", "-s", "-", "--deep", stagedApp]');
  const verifyIndex = install.indexOf('run(["codesign", "--verify", "--deep", "--strict", stagedApp]');
  expect(copyIndex).toBeGreaterThan(-1);
  expect(signIndex).toBeGreaterThan(copyIndex);
  expect(verifyIndex).toBeGreaterThan(signIndex);
  expect(install).toContain("replaceDirectoryAtomically(stagedApp, PATCHED_APP)");
});


test("webapp payload refresh re-signs and verifies the completed app bundle", () => {
  expect(runtimeSetup).toContain('runChecked("codesign", ["-f", "-s", "-", "--deep", appBundle]');
  expect(runtimeSetup).toContain('runChecked("codesign", ["--verify", "--deep", "--strict", appBundle]');
});
