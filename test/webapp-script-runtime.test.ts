import { expect, test } from "bun:test";
import packageJson from "../webapp/package.json";

test("webapp package scripts do not recurse through a package-local bun shim", () => {
  for (const [name, script] of Object.entries(packageJson.scripts)) {
    if (!/\bbun\b/.test(script)) continue;
    expect(script, `${name} must use npm_execpath instead of bare bun`).toContain("$npm_execpath");
    expect(script, `${name} must not invoke bare bun`).not.toMatch(/(^|[;&|]\s*)bun\b/);
  }
});
