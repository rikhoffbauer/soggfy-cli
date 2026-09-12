import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DownloadJob } from "../models";
import { playerStatus } from "../player-model";

const root = join(import.meta.dir, "../../../../..");
const source = (path: string) => readFileSync(join(root, path), "utf8");
function job(state: DownloadJob["state"]): DownloadJob {
  return { id: state, trackId: "4PTG3Z6ehGkBFwjybzWkR8", state, createdAt: "", updatedAt: "", attempts: 0, bytesCaptured: 0, logs: [] };
}

test("terminal player states win over buffering and intermediate states are specific", () => {
  expect(playerStatus(job("failed"), false, true)).toBe("Playback failed");
  expect(playerStatus(job("cancelled"), false, true)).toBe("Cancelled");
  expect(playerStatus(job("queued"), false, false)).toBe("Queued");
  expect(playerStatus(job("assigned"), false, false)).toBe("Assigned");
  expect(playerStatus(job("finalizing"), false, false)).toBe("Finalizing");
  expect(playerStatus(job("transcoding"), false, false)).toBe("Transcoding");
});

test("browser entry module is deferred rather than async", () => {
  const html = source("webapp/src/index.html");
  expect(html).toContain('<script type="module" src="./frontend.tsx"></script>');
  expect(html).not.toContain("frontend.tsx\" async");
});

test("playlist issue rows align with normal track rows", () => {
  const playlist = source("webapp/src/components/soggfy/PlaylistPanel.tsx");
  expect(playlist).toContain("grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto]");
  expect(playlist).toContain("sm:px-3");
});

test("track labels account for transcoding and finalizing", () => {
  const track = source("webapp/src/components/soggfy/TrackListRow.tsx");
  expect(track).toContain('job.state === "transcoding"');
  expect(track).toContain('job.state === "finalizing"');
});

test("new audio sources inherit stored volume", () => {
  const player = source("webapp/src/components/soggfy/PlayerBar.tsx");
  const sourceLoad = player.slice(player.indexOf("audio.src = streamUrl(job)"), player.indexOf("audio.load()") + 20);
  expect(sourceLoad).toContain("audio.volume = volume");
});

test("album loading rejects successful responses without an album before hint merge", () => {
  const app = source("webapp/src/App.tsx");
  const guard = app.indexOf('if (!data.album) throw new Error("Album lookup returned no album")');
  const merge = app.indexOf("if (albumHint?.type === \"album\"");
  expect(guard).toBeGreaterThan(-1);
  expect(guard).toBeLessThan(merge);
});

test("download-all link is the sole interactive element", () => {
  const workspace = source("webapp/src/components/soggfy/JobWorkspace.tsx");
  expect(workspace).not.toMatch(/<a[^>]*download-all[^>]*>\s*<Button/s);
  expect(workspace).toContain("buttonVariants");
});

test("navigation source range anchors are explicitly asserted", () => {
  const navTest = source("webapp/src/components/soggfy/__tests__/navigation-ui-source.test.ts");
  expect(navTest).toContain("expect(submitSearchStart).toBeGreaterThanOrEqual(0)");
  expect(navTest).toContain("expect(changeSearchTabStart).toBeGreaterThanOrEqual(0)");
});
