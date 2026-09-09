import { expect, test } from "bun:test";
import type { DownloadJob } from "../models";
import { playerStatus, seekLimit } from "../player-model";

function job(state: DownloadJob["state"]): DownloadJob {
  return {
    id: `job-${state}`,
    trackId: "4PTG3Z6ehGkBFwjybzWkR8",
    state,
    createdAt: "2026-09-09T00:00:00Z",
    updatedAt: "2026-09-09T00:00:00Z",
    attempts: 1,
    bytesCaptured: 100,
    logs: [],
  };
}

test("player status distinguishes buffering, active download, pause, and completion", () => {
  const capturing = job("capturing");
  expect(playerStatus(capturing, false, true)).toBe("Buffering");
  expect(playerStatus(capturing, true, false)).toBe("Playing · downloading");
  expect(playerStatus(capturing, false, false)).toBe("Paused · downloading");
  expect(playerStatus(job("completed"), false, false)).toBe("Downloaded");
});

test("incomplete jobs only seek within browser-buffered media", () => {
  expect(seekLimit(job("capturing"), 240, 37)).toBe(37);
  expect(seekLimit(job("capturing"), 240, 0)).toBe(0);
  expect(seekLimit(job("completed"), 240, 37)).toBe(240);
});

test("PlayerBar binds the stream to the exact job and App resolves active player jobs", async () => {
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const componentDir = join(import.meta.dir, "..");
  const playerSource = readFileSync(join(componentDir, "PlayerBar.tsx"), "utf8");
  const appSource = readFileSync(join(componentDir, "../../App.tsx"), "utf8");
  expect(playerSource).toContain("&job=${job.id}");
  expect(playerSource).toContain("playerStatus");
  expect(appSource).toContain("job.id === playerJobId");
  expect(appSource).not.toContain('job.id === playerJobId && job.state === "completed"');
});
