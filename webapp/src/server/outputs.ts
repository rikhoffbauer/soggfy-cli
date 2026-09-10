import { existsSync } from "fs";
import { extname, join } from "path";
import { OUTPUT_DIR } from "../../../src/core/paths";
import { jobs } from "./runtime-state";

export function findOutputForTrack(trackId: string): { path: string; format: "mp3" | "wav" | "ogg" } | null {
  const job = jobs.findByTrack(trackId);
  if (job?.savedPath && existsSync(job.savedPath)) {
    const ext = extname(job.savedPath).slice(1).toLowerCase();
    const inferred = ext === "ogg" ? "ogg" : ext === "wav" ? "wav" : "mp3";
    return { path: job.savedPath, format: job.outputFormat || inferred };
  }
  for (const format of ["mp3", "ogg", "wav"] as const) {
    const path = join(OUTPUT_DIR, `${trackId}.${format}`);
    if (existsSync(path)) return { path, format };
  }
  return null;
}
