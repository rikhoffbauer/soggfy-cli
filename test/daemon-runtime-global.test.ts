import { expect, test } from "bun:test";

test("daemon runtime registration is shared across independently bundled module copies", async () => {
  const a = await import(`../src/core/daemon-runtime.ts?copy=a-${Date.now()}`);
  const b = await import(`../src/core/daemon-runtime.ts?copy=b-${Date.now()}`);
  const fake = { sendCommand: async () => "pong" } as any;

  a.registerDaemonSpotifyInstance(fake);
  try {
    expect(b.getDaemonSpotifyInstance()).toBe(fake);
  } finally {
    a.unregisterDaemonSpotifyInstance(fake);
  }
});
