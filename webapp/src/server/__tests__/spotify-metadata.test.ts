import { expect, test } from "bun:test";
import { fetchTrackDuration, fetchTrackMetadata } from "../spotify-metadata";

async function expectDeadline(
  call: (fetchImpl: typeof fetch, timeoutMs: number) => Promise<unknown>,
): Promise<void> {
  const signals: AbortSignal[] = [];
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
    if (!(init?.signal instanceof AbortSignal)) return;
    signals.push(init.signal);
    init.signal.addEventListener("abort", () => resolve(new Response(null, { status: 408 })), { once: true });
  })) as unknown as typeof fetch;

  await call(fetchImpl, 20);
  expect(signals).toHaveLength(1);
  expect(signals[0]).toBeInstanceOf(AbortSignal);
  expect(signals[0]?.aborted).toBe(true);
}

test("Spotify embed metadata requests enforce their deadline", async () => {
  await expectDeadline((fetchImpl, timeoutMs) => fetchTrackDuration("track", fetchImpl, timeoutMs));
  await expectDeadline((fetchImpl, timeoutMs) => fetchTrackMetadata("track", fetchImpl, timeoutMs));
});
