import { expect, test } from "bun:test";
import {
  findDaemonOwnerFromSnapshots,
  findLegacyDaemonOwnerFromSnapshots,
  retireLegacyDaemonOwner,
} from "../src/core/daemon-owner";

const socket = "/tmp/soggfy_cli.sock";

test("identifies a legacy Soggfy daemon through the shared IPC socket owner", () => {
  const lsof = `Spotify 77585 user 3u unix 0x1 0t0 ${socket}\n`;
  const ps = [
    "73096 1 /Users/user/.bun/bin/bun /repo/soggfy-cli/src/cli.ts daemon run",
    "77585 73096 /Users/user/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify --hidden",
  ].join("\n");

  expect(findLegacyDaemonOwnerFromSnapshots(socket, lsof, ps, 99999)).toEqual({
    daemonPid: 73096,
    spotifyPid: 77585,
  });
});

test("ignores unrelated Unix socket owners and the current daemon", () => {
  const unrelatedLsof = `node 111 user 3u unix 0x1 0t0 ${socket}\n`;
  const unrelatedPs = "111 1 node server.js";
  expect(findLegacyDaemonOwnerFromSnapshots(socket, unrelatedLsof, unrelatedPs, 99999)).toBeNull();

  const selfLsof = `Spotify 222 user 3u unix 0x1 0t0 ${socket}\n`;
  const selfPs = [
    "99999 1 bun /repo/soggfy-cli/src/cli.ts daemon run",
    "222 99999 /Users/user/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify",
  ].join("\n");
  expect(findLegacyDaemonOwnerFromSnapshots(socket, selfLsof, selfPs, 99999)).toBeNull();
});

test("identifies the daemon process that owns the identity socket", () => {
  const identitySocket = "/Users/user/.soggfy/daemon.sock";
  const lsof = `bun 73096 user 4u unix 0x2 0t0 ${identitySocket}\n`;
  const ps = "73096 1 /Users/user/.bun/bin/bun /repo/soggfy-cli/src/cli.ts daemon run";
  expect(findDaemonOwnerFromSnapshots(identitySocket, lsof, ps)).toBe(73096);
});


test("legacy daemon retirement refuses a reused PID with a different fingerprint", async () => {
  const owner = {
    daemonPid: 73096,
    spotifyPid: 77585,
    daemonFingerprint: {
      startedAt: "Thu Sep 10 13:46:55 2026",
      command: "/Users/user/.bun/bin/bun /repo/soggfy-cli/src/cli.ts daemon run",
    },
  };
  let terminated = false;
  await expect(retireLegacyDaemonOwner(owner, {
    readFingerprint: () => ({
      startedAt: "Thu Sep 10 13:47:01 2026",
      command: "/usr/bin/python3 unrelated.py",
    }),
    terminate: async () => { terminated = true; },
  })).rejects.toThrow("identity changed");
  expect(terminated).toBe(false);
});
