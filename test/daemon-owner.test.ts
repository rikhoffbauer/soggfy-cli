import { expect, test } from "bun:test";
import {
  findDaemonOwnerFromSnapshots,
  findLegacyDaemonOwnerFromSnapshots,
  findOrphanSpotifyOwnerFromSnapshots,
  inspectOrphanSpotifyOwner,
  inspectOrphanSpotifyOwnerFromSnapshots,
  retireLegacyDaemonOwner,
  retireOrphanSpotifyOwner,
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


test("legacy daemon retirement rejects same-second PID reuse via kernel birth id", async () => {
  const owner = {
    daemonPid: 73096,
    spotifyPid: 77585,
    daemonFingerprint: {
      startedAt: "Thu Sep 10 13:46:55 2026",
      birthId: "1789047322:111111",
      command: "/Users/user/.bun/bin/bun /repo/soggfy-cli/src/cli.ts daemon run",
    },
  };
  let terminated = false;
  await expect(retireLegacyDaemonOwner(owner, {
    readFingerprint: () => ({
      startedAt: "Thu Sep 10 13:46:55 2026",
      birthId: "1789047322:222222",
      command: "/Users/user/.bun/bin/bun /repo/soggfy-cli/src/cli.ts daemon run",
    }),
    terminate: async () => { terminated = true; },
  })).rejects.toThrow("identity changed");
  expect(terminated).toBe(false);
});

test("legacy daemon retirement refuses a reused PID with a different fingerprint", async () => {
  const owner = {
    daemonPid: 73096,
    spotifyPid: 77585,
    daemonFingerprint: {
      startedAt: "Thu Sep 10 13:46:55 2026",
      birthId: "1789047322:111111",
      command: "/Users/user/.bun/bin/bun /repo/soggfy-cli/src/cli.ts daemon run",
    },
  };
  let terminated = false;
  await expect(retireLegacyDaemonOwner(owner, {
    readFingerprint: () => ({
      startedAt: "Thu Sep 10 13:47:01 2026",
      birthId: "1789047328:000001",
      command: "/usr/bin/python3 unrelated.py",
    }),
    terminate: async () => { terminated = true; },
  })).rejects.toThrow("identity changed");
  expect(terminated).toBe(false);
});


test("identifies only an orphaned Soggfy Spotify root for the exact profile", () => {
  const binary = "/Users/user/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify";
  const profile = "/Users/user/.soggfy/workspace/profiles/cli_instance";
  const ps = [
    `8061 1 ${binary} --disable-gpu --user-data-dir=${profile}`,
    `9000 7000 ${binary} --user-data-dir=${profile}`,
    `9100 1 ${binary} --user-data-dir=/tmp/compat-profile`,
    `9200 1 /Applications/Spotify.app/Contents/MacOS/Spotify --user-data-dir=${profile}`,
  ].join("\n");

  expect(findOrphanSpotifyOwnerFromSnapshots(binary, profile, ps)).toBe(8061);
  expect(findOrphanSpotifyOwnerFromSnapshots(binary, "/tmp/other-profile", ps)).toBeNull();
});



test("classifies an exact orphan as unverifiable when its kernel identity cannot be read", () => {
  const binary = "/Users/user/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify";
  const profile = "/Users/user/.soggfy/workspace/profiles/cli_instance";
  const ps = `8061 1 ${binary} --disable-gpu --user-data-dir=${profile}`;

  expect(inspectOrphanSpotifyOwnerFromSnapshots(binary, profile, ps, () => null)).toEqual({
    kind: "unverifiable",
    spotifyPid: 8061,
  });
});

test("orphan Spotify retirement refuses PID reuse before signaling", async () => {
  const binary = "/Users/user/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify";
  const profile = "/Users/user/.soggfy/workspace/profiles/cli_instance";
  const owner = {
    spotifyPid: 8061,
    binaryPath: binary,
    profileDir: profile,
    spotifyFingerprint: {
      startedAt: "Thu Sep 11 02:12:14 2026",
      birthId: "1789092734:111111",
      command: `${binary} --user-data-dir=${profile}`,
    },
  };
  let terminated = false;
  await expect(retireOrphanSpotifyOwner(owner, {
    readFingerprint: () => ({
      startedAt: "Thu Sep 11 02:12:14 2026",
      birthId: "1789092734:222222",
      command: `${binary} --user-data-dir=${profile}`,
    }),
    terminate: async () => { terminated = true; },
  })).rejects.toThrow("identity changed");
  expect(terminated).toBe(false);
});


test("orphan Spotify retirement accepts the process disappearing after its first verified signal", async () => {
  const binary = "/Users/user/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify";
  const profile = "/Users/user/.soggfy/workspace/profiles/cli_instance";
  const fingerprint = {
    startedAt: "Thu Sep 11 02:12:14 2026",
    birthId: "1789092734:111111",
    command: `${binary} --user-data-dir=${profile}`,
  };
  const owner = {
    spotifyPid: 8061,
    binaryPath: binary,
    profileDir: profile,
    spotifyFingerprint: fingerprint,
  };
  let current: typeof fingerprint | null = fingerprint;
  let terminateTreeCalled = false;

  await retireOrphanSpotifyOwner(owner, {
    readFingerprint: () => current,
    terminateTree: async (_pid, _exited, options) => {
      terminateTreeCalled = true;
      options.beforeSignal?.(8061, "SIGTERM");
      current = null;
      options.beforeSignal?.(8061, "SIGKILL");
    },
  });

  expect(terminateTreeCalled).toBe(true);
});

test("orphan Spotify inspection preserves an unavailable process-table state", () => {
  const binary = "/Users/user/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify";
  const profile = "/Users/user/.soggfy/workspace/profiles/cli_instance";
  expect(inspectOrphanSpotifyOwner(binary, profile, () => null)).toEqual({ kind: "unavailable" });
});
