import { expect, test } from "bun:test";
import { parseWebServerOptions } from "../src/commands/web";

test("web command accepts daemon web bind options", () => {
  expect(parseWebServerOptions([])).toEqual({});
  expect(parseWebServerOptions(["--host", "0.0.0.0", "--port", "9090"]))
    .toEqual({ host: "0.0.0.0", port: 9090 });
});

test("web command rejects invalid values and standalone-only options", () => {
  expect(() => parseWebServerOptions(["--port", "0"])).toThrow("--port must be between 1 and 65535");
  expect(() => parseWebServerOptions(["--port", "many"])).toThrow("--port must be an integer");
  expect(() => parseWebServerOptions(["--pool-size", "2"])).toThrow("Unknown web option: --pool-size");
});
