import { expect, test } from "bun:test";
import { collectRendererPages } from "../src/core/spotify-renderer-library";

test("renderer pagination continues after a short page when no total is advertised", async () => {
  const requests: number[] = [];
  const pages = new Map<number, { items: number[]; totalLength: number }>([
    [0, { items: [1, 2, 3], totalLength: 0 }],
    [3, { items: [4], totalLength: 0 }],
    [4, { items: [5, 6], totalLength: 0 }],
    [6, { items: [], totalLength: 0 }],
  ]);
  const result = await collectRendererPages(async (offset) => {
    requests.push(offset);
    return pages.get(offset) ?? { items: [], totalLength: 0 };
  }, 3);
  expect(result.items).toEqual([1, 2, 3, 4, 5, 6]);
  expect(result.totalCount).toBe(6);
  expect(requests).toEqual([0, 3, 4, 6]);
});

test("renderer pagination stops at an advertised total without an extra request", async () => {
  const requests: number[] = [];
  const result = await collectRendererPages(async (offset) => {
    requests.push(offset);
    return offset === 0
      ? { items: [1, 2], totalLength: 3 }
      : { items: [3], totalLength: 3 };
  }, 2);
  expect(result).toEqual({ items: [1, 2, 3], totalCount: 3 });
  expect(requests).toEqual([0, 2]);
});

import { waitForRendererLikedSongsReady } from "../src/core/spotify-renderer-library";

test("renderer library waits past a temporary local-only liked-song view", async () => {
  let calls = 0;
  const waits: number[] = [];
  await waitForRendererLikedSongsReady(async () => {
    calls += 1;
    return calls === 1
      ? { items: [{ uri: "spotify:local:::temporary:1", isLocal: true }], totalLength: 0 }
      : { items: [{ uri: "spotify:track:1111111111111111111111", isLocal: false }], totalLength: 0 };
  }, 3, 25, async (ms) => { waits.push(ms); });
  expect(calls).toBe(2);
  expect(waits).toEqual([25]);
});

test("renderer library eventually accepts a genuinely local-only account", async () => {
  let calls = 0;
  await waitForRendererLikedSongsReady(async () => {
    calls += 1;
    return { items: [{ uri: "spotify:local:::only:1", isLocal: true }], totalLength: 0 };
  }, 3, 0, async () => {});
  expect(calls).toBe(3);
});
