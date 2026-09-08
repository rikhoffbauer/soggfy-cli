import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const source = readFileSync(join(import.meta.dir, "../webapp/src/index.ts"), "utf8");

test("webapp uses the same IPC transport as the CLI", () => {
  expect(source).toContain('from "../../src/core/ipc"');
  expect(source).not.toContain('from "net"');
  expect(source).toContain("sendIpcCommand(this.socketPath, command");
});
