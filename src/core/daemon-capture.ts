import { existsSync, statSync } from "fs";
import { getHttpOrigin } from "./http-config";
import { readDaemonIdentity } from "./daemon-identity";
import { DAEMON_SOCKET } from "./paths";
import type { CaptureResult } from "./capture";
import type { TrackMetadata } from "./metadata";

interface DaemonJob {
  id: string;
  trackId: string;
  state: string;
  savedPath?: string;
  sizeBytes?: number;
  durationMs?: number;
  error?: string;
  metadata?: TrackMetadata;
}

interface JobsSnapshot {
  jobs?: DaemonJob[];
}

interface SubmitResponse {
  jobs?: DaemonJob[];
}

export interface DaemonCaptureOptions {
  origin?: string;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  timeoutMs?: number;
  identitySocket?: string;
}

function apiHeaders(json = false): Headers {
  const headers = new Headers();
  const token = process.env.SOGGFY_API_TOKEN?.trim();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (json) headers.set("content-type", "application/json");
  return headers;
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text || `${response.status} ${response.statusText}`;
}

async function resolveDaemonOrigin(options: DaemonCaptureOptions): Promise<string> {
  if (options.origin) return options.origin;
  const identity = await readDaemonIdentity(options.identitySocket ?? DAEMON_SOCKET).catch(() => null);
  return identity?.httpOrigin ?? getHttpOrigin();
}

export async function daemonApiHealthy(options: DaemonCaptureOptions = {}): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin = await resolveDaemonOrigin(options);
  try {
    const response = await fetchImpl(`${origin}/api/health`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: boolean; started?: boolean };
    return body.ok === true && body.started === true;
  } catch {
    return false;
  }
}

export async function captureTrackViaDaemon(
  trackId: string,
  options: DaemonCaptureOptions = {},
): Promise<CaptureResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin = await resolveDaemonOrigin(options);
  const pollMs = options.pollMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 45 * 60_000;

  const submit = await fetchImpl(`${origin}/api/download`, {
    method: "POST",
    headers: apiHeaders(true),
    body: JSON.stringify({ trackId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) throw new Error(`Daemon scheduler rejected ${trackId}: ${await responseError(submit)}`);
  const submitted = await submit.json() as SubmitResponse;
  const job = submitted.jobs?.find((candidate) => candidate.trackId === trackId) ?? submitted.jobs?.[0];
  if (!job?.id) throw new Error(`Daemon scheduler did not return a job id for ${trackId}`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetchImpl(`${origin}/api/jobs`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Failed to read daemon job ${job.id}: ${await responseError(response)}`);
    const snapshot = await response.json() as JobsSnapshot;
    const current = snapshot.jobs?.find((candidate) => candidate.id === job.id);
    if (!current) throw new Error(`Daemon job disappeared before completion: ${job.id}`);

    if (current.state === "completed") {
      if (!current.savedPath || !existsSync(current.savedPath)) {
        throw new Error(`Daemon job ${job.id} completed without an accessible saved artifact`);
      }
      return {
        trackId: current.trackId,
        wavPath: current.savedPath,
        bytesWritten: current.sizeBytes ?? statSync(current.savedPath).size,
        durationMs: current.durationMs,
        metadata: current.metadata ?? {},
      };
    }
    if (current.state === "failed" || current.state === "cancelled") {
      throw new Error(current.error || `Daemon job ${job.id} ${current.state}`);
    }
    await Bun.sleep(pollMs);
  }

  throw new Error(`Timed out waiting for daemon job ${job.id} after ${timeoutMs}ms`);
}
