import type { DownloadJob } from "./jobs";

export interface QueueEntry {
  job: DownloadJob;
  resolve: (value: DownloadJob) => void;
  reject: (error: Error) => void;
}

export class PriorityJobQueue {
  private entries: QueueEntry[] = [];

  enqueue(entry: QueueEntry): boolean {
    if (this.entries.some((item) => item.job.id === entry.job.id)) return false;
    this.entries.push(entry);
    return true;
  }

  promote(jobId: string): boolean {
    const index = this.entries.findIndex((item) => item.job.id === jobId);
    if (index < 0) return false;
    const [entry] = this.entries.splice(index, 1);
    if (!entry) return false;
    this.entries.unshift(entry);
    return true;
  }

  insertInterrupted(entry: QueueEntry): boolean {
    this.remove(entry.job.id);
    this.entries.splice(Math.min(1, this.entries.length), 0, entry);
    return true;
  }
  remove(jobId: string): QueueEntry | undefined {
    const index = this.entries.findIndex((item) => item.job.id === jobId);
    if (index < 0) return undefined;
    const [entry] = this.entries.splice(index, 1);
    return entry;
  }

  shift(): QueueEntry | undefined {
    return this.entries.shift();
  }

  ids(): string[] {
    return this.entries.map((entry) => entry.job.id);
  }

  snapshot(): readonly QueueEntry[] {
    return [...this.entries];
  }

  find(jobId: string): QueueEntry | undefined {
    return this.entries.find((entry) => entry.job.id === jobId);
  }

  get length(): number {
    return this.entries.length;
  }
}
