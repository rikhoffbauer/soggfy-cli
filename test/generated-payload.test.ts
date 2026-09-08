import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const payload = "src/payload/libsoggfy.dylib";

test("generated native payload stays out of tracked source paths", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const tracked = Bun.spawnSync(["git", "ls-files", "--error-unmatch", payload], { cwd: root });

  expect(pkg.scripts["build:payload"]).not.toContain(payload);
  expect(ignore.split(/\r?\n/)).toContain(`/${payload}`);
  expect(ci).not.toContain(payload);
  expect(ci).toContain("soggfy-macos/build/libsoggfy.dylib");
  expect(tracked.exitCode).not.toBe(0);
});

test("source installs cannot prefer a stale ignored payload copy", () => {
  const install = readFileSync(join(root, "src/commands/install.ts"), "utf8");
  expect(install).toContain('const bundledPrebuiltDylib = join(import.meta.dir, "..", "payload", "libsoggfy.dylib")');
  expect(install).toContain('const hasPayloadSource = existsSync(join(repoPayloadDir, "CMakeLists.txt"))');
  expect(install).toContain("if (!hasPayloadSource && !rebuild && existsSync(bundledPrebuiltDylib))");
});
