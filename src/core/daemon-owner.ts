import { terminateProcessTree } from "./spotify-runtime";
import { readKernelProcessBirthId } from "./process-birth";

export interface ProcessFingerprint {
  startedAt: string;
  birthId: string;
  command: string;
}

export interface LegacyDaemonCandidate {
  daemonPid: number;
  spotifyPid: number;
}

export interface LegacyDaemonOwner extends LegacyDaemonCandidate {
  daemonFingerprint: ProcessFingerprint;
}

interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

function processRows(text: string): Map<number, ProcessRow> {
  const rows = new Map<number, ProcessRow>();
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    rows.set(pid, { pid, ppid, command: match[3]! });
  }
  return rows;
}

function socketOwnerPids(socketPath: string, text: string): number[] {
  const escaped = socketPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const owner = new RegExp(`^\\S+\\s+(\\d+)\\s+.*\\s${escaped}$`);
  return text.split("\n").flatMap((line) => {
    const match = line.match(owner);
    return match ? [Number(match[1])] : [];
  });
}

function isSoggfyDaemonCommand(command: string): boolean {
  return /\bsoggfy(?:-cli)?\b/i.test(command) && /\bdaemon\s+run\b/.test(command);
}

export function findDaemonOwnerFromSnapshots(
  socketPath: string,
  lsofText: string,
  psText: string,
): number | null {
  const processes = processRows(psText);
  for (const pid of socketOwnerPids(socketPath, lsofText)) {
    const process = processes.get(pid);
    if (process && isSoggfyDaemonCommand(process.command)) return pid;
  }
  return null;
}

export function findLegacyDaemonOwnerFromSnapshots(
  socketPath: string,
  lsofText: string,
  psText: string,
  currentPid = process.pid,
): LegacyDaemonCandidate | null {
  const processes = processRows(psText);
  for (const spotifyPid of socketOwnerPids(socketPath, lsofText)) {
    const spotify = processes.get(spotifyPid);
    if (!spotify || !spotify.command.includes("/PatchedSpotify.app/Contents/MacOS/Spotify")) continue;
    const daemon = processes.get(spotify.ppid);
    if (!daemon || daemon.pid === currentPid || !isSoggfyDaemonCommand(daemon.command)) continue;
    return { daemonPid: daemon.pid, spotifyPid };
  }
  return null;
}

function ownershipSnapshots(): { lsof: string; ps: string } | null {
  const lsof = Bun.spawnSync(["lsof", "-n", "-U"], { stdout: "pipe", stderr: "pipe" });
  if (lsof.exitCode !== 0) return null;
  const ps = Bun.spawnSync(["ps", "-ww", "-axo", "pid=,ppid=,command="], { stdout: "pipe", stderr: "pipe" });
  if (ps.exitCode !== 0) return null;
  return { lsof: lsof.stdout.toString(), ps: ps.stdout.toString() };
}

export function readProcessFingerprint(pid: number): ProcessFingerprint | null {
  const ps = Bun.spawnSync(["ps", "-ww", "-p", String(pid), "-o", "lstart=", "-o", "command="], {
    env: { ...process.env, LC_ALL: "C", LC_TIME: "C" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (ps.exitCode !== 0) return null;
  const birthId = readKernelProcessBirthId(pid);
  if (!birthId) return null;
  const output = ps.stdout.toString().trimEnd();
  const match = output.match(/^(.{24})\s+(.+)$/);
  if (!match) return null;
  return { startedAt: match[1]!.trim(), birthId, command: match[2]! };
}

export function findDaemonOwner(socketPath: string): number | null {
  const snapshot = ownershipSnapshots();
  return snapshot ? findDaemonOwnerFromSnapshots(socketPath, snapshot.lsof, snapshot.ps) : null;
}

export function findLegacyDaemonOwner(socketPath: string, currentPid = process.pid): LegacyDaemonOwner | null {
  const snapshot = ownershipSnapshots();
  if (!snapshot) return null;
  const candidate = findLegacyDaemonOwnerFromSnapshots(socketPath, snapshot.lsof, snapshot.ps, currentPid);
  if (!candidate) return null;
  const daemonFingerprint = readProcessFingerprint(candidate.daemonPid);
  if (!daemonFingerprint || !isSoggfyDaemonCommand(daemonFingerprint.command)) return null;
  return { ...candidate, daemonFingerprint };
}

function assertProcessFingerprint(
  pid: number,
  expected: ProcessFingerprint,
  readFingerprint: (pid: number) => ProcessFingerprint | null,
): void {
  const current = readFingerprint(pid);
  if (
    !current ||
    current.startedAt !== expected.startedAt ||
    current.birthId !== expected.birthId ||
    current.command !== expected.command ||
    !isSoggfyDaemonCommand(current.command)
  ) {
    throw new Error(`Legacy Soggfy daemon identity changed for PID ${pid}; refusing to terminate it.`);
  }
}

export interface LegacyDaemonRetireDependencies {
  readFingerprint?: (pid: number) => ProcessFingerprint | null;
  terminate?: (
    pid: number,
    expectedFingerprint: ProcessFingerprint,
    readFingerprint: (pid: number) => ProcessFingerprint | null,
  ) => Promise<void>;
}

async function terminateVerifiedLegacyDaemon(
  pid: number,
  expectedFingerprint: ProcessFingerprint,
  readFingerprint: (pid: number) => ProcessFingerprint | null,
): Promise<void> {
  await terminateProcessTree(pid, undefined, {
    beforeSignal: () => assertProcessFingerprint(pid, expectedFingerprint, readFingerprint),
  });
}

export async function retireLegacyDaemonOwner(
  owner: LegacyDaemonOwner,
  dependencies: LegacyDaemonRetireDependencies = {},
): Promise<void> {
  const readFingerprint = dependencies.readFingerprint ?? readProcessFingerprint;
  assertProcessFingerprint(owner.daemonPid, owner.daemonFingerprint, readFingerprint);
  await (dependencies.terminate ?? terminateVerifiedLegacyDaemon)(
    owner.daemonPid,
    owner.daemonFingerprint,
    readFingerprint,
  );
}
