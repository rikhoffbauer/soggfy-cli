import { afterEach, expect, test } from "bun:test";
import { createApiRoutes } from "../routes";
import { pool } from "../runtime";

const trackId = "4PTG3Z6ehGkBFwjybzWkR8";
const originalAddJob = pool.addJob;
const originalFetch = globalThis.fetch;

afterEach(() => {
  pool.addJob = originalAddJob;
  globalThis.fetch = originalFetch;
});

test("direct trackId download returns the scheduler job for CLI callers", async () => {
  const fakeJob = { id: "cli-job", trackId, state: "queued" } as any;
  pool.addJob = (async (input: string) => {
    expect(input).toBe(trackId);
    return fakeJob;
  }) as typeof pool.addJob;

  const response = await createApiRoutes()["/api/download"].POST(new Request("http://127.0.0.1/api/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trackId }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ jobs: [fakeJob], jobIds: ["cli-job"] });
});

test("URL download keeps queueing in the background instead of awaiting capture setup", async () => {
  globalThis.fetch = (async () => { throw new Error("offline fixture"); }) as unknown as typeof fetch;
  pool.addJob = (() => new Promise(() => undefined)) as typeof pool.addJob;

  const route = createApiRoutes()["/api/download"].POST;
  const responsePromise = route(new Request("http://127.0.0.1/api/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: `spotify:track:${trackId}` }),
  }));
  const result = await Promise.race([
    responsePromise.then((response) => ({ kind: "response" as const, response })),
    Bun.sleep(50).then(() => ({ kind: "timeout" as const })),
  ]);

  expect(result.kind).toBe("response");
  if (result.kind === "response") {
    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toMatchObject({ success: true, queued: true, count: 1 });
  }
});
