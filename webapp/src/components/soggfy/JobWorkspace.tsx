import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconHistory,
  IconMusic,
  IconPlayerPlay,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DownloadJob } from "./models";

interface QueuePageProps {
  queue: DownloadJob[];
  onAction: (jobId: string, action: "cancel" | "retry") => void;
}

interface DownloadsPageProps {
  library: DownloadJob[];
  onAction: (jobId: string, action: "cancel" | "retry") => void;
  onPlay: (job: DownloadJob) => void;
}

export function QueuePage({ queue, onAction }: QueuePageProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Queue" subtitle={queue.length ? `${queue.length} active ${queue.length === 1 ? "job" : "jobs"}` : "Nothing waiting"} />
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-y border-white/[0.06]">
        {queue.length ? queue.map((job) => (
          <QueueRow key={job.id} job={job} onCancel={() => onAction(job.id, "cancel")} />
        )) : <EmptyState icon={<IconDownload />} title="Queue is clear" body="Search for music and queue a track to start a capture." />}
      </div>
    </section>
  );
}

export function DownloadsPage({ library, onAction, onPlay }: DownloadsPageProps) {
  const completed = library.filter((job) => job.state === "completed");
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-4">
        <PageHeader title="Downloads" subtitle={`${library.length} recent ${library.length === 1 ? "item" : "items"}`} />
        {completed.length > 1 ? (
          <a href="/api/download-all" className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "shrink-0")}><IconDownload className="size-4" /> ZIP all</a>
        ) : null}
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-y border-white/[0.06]">
        {library.length ? library.map((job) => (
          <DownloadRow key={job.id} job={job} onRetry={() => onAction(job.id, "retry")} onPlay={() => onPlay(job)} />
        )) : <EmptyState icon={<IconHistory />} title="No downloads yet" body="Completed and failed downloads will appear here." />}
      </div>
    </section>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="shrink-0"><h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1><p className="mt-1 text-sm text-white/40">{subtitle}</p></div>;
}

function QueueRow({ job, onCancel }: { job: DownloadJob; onCancel: () => void }) {
  const pct = progressPercent(job);
  const indeterminate = !job.expectedBytes || job.expectedBytes <= 0;
  return (
    <div className="grid min-h-16 grid-cols-[2.75rem_minmax(180px,1.7fr)_minmax(120px,.8fr)_minmax(160px,1fr)_auto] items-center gap-4 border-b border-white/[0.05] px-3 py-2 last:border-b-0 hover:bg-white/[0.025] max-xl:grid-cols-[2.75rem_minmax(0,1fr)_minmax(160px,.8fr)_auto] max-md:grid-cols-[2.75rem_minmax(0,1fr)_auto]">
      <Artwork job={job} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white/90">{jobTitle(job)}</div>
        <div className="truncate text-xs text-white/36">{jobArtist(job)}</div>
      </div>
      <div className="min-w-0 max-md:hidden">
        <div className="text-xs font-medium text-white/60">{stateLabel(job.state)}</div>
        <div className="mt-0.5 truncate text-[10px] text-white/28">{job.instanceId ? `Instance ${job.instanceId}` : "Waiting for instance"}</div>
      </div>
      <div className="min-w-0 max-xl:hidden">
        <div className="flex items-center gap-2">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/8"><div className={`h-full rounded-full bg-primary ${indeterminate ? "soggfy-progress-indeterminate w-1/3" : ""}`} style={indeterminate ? undefined : { width: `${pct}%` }} /></div>
          <span className="w-10 text-right text-[10px] tabular-nums text-white/35">{indeterminate ? "—" : `${pct}%`}</span>
        </div>
        <div className="mt-1 flex justify-between gap-3 text-[10px] text-white/26"><span className="truncate">{stateDetail(job)}</span>{job.bytesCaptured > 0 ? <span className="shrink-0 tabular-nums">{formatBytes(job.bytesCaptured)}{job.expectedBytes ? ` / ${formatBytes(job.expectedBytes)}` : ""}</span> : null}</div>
      </div>
      <IconButton label={`Cancel ${jobTitle(job)}`} onClick={onCancel} danger><IconX className="size-4" /></IconButton>
    </div>
  );
}

function DownloadRow({ job, onRetry, onPlay }: { job: DownloadJob; onRetry: () => void; onPlay: () => void }) {
  const completed = job.state === "completed";
  return (
    <div className="grid min-h-16 grid-cols-[2.75rem_minmax(180px,1.8fr)_minmax(100px,.55fr)_minmax(100px,.55fr)_minmax(110px,.6fr)_auto] items-center gap-4 border-b border-white/[0.05] px-3 py-2 last:border-b-0 hover:bg-white/[0.025] max-lg:grid-cols-[2.75rem_minmax(0,1fr)_minmax(100px,.6fr)_auto] max-sm:grid-cols-[2.75rem_minmax(0,1fr)_auto]">
      <Artwork job={job} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white/88">{jobTitle(job)}</div>
        <div className="truncate text-xs text-white/35">{jobArtist(job)}</div>
        {!completed && job.error ? <div className="mt-0.5 truncate text-[10px] text-red-300/70" title={job.error}>{job.error}</div> : null}
      </div>
      <div className="text-xs tabular-nums text-white/40 max-lg:hidden">{job.durationMs ? formatDuration(job.durationMs) : "—"}</div>
      <div className="text-xs tabular-nums text-white/40 max-lg:hidden">{job.sizeBytes ? formatBytes(job.sizeBytes) : "—"}</div>
      <div className="flex items-center gap-2 text-xs text-white/45 max-sm:hidden">{completed ? <IconCheck className="size-4 text-primary" /> : <IconAlertTriangle className="size-4 text-amber-300/70" />}<span className="capitalize">{job.state}</span></div>
      <div className="flex items-center justify-end gap-1">
        {completed ? <><IconButton label="Play" onClick={onPlay}><IconPlayerPlay className="size-4" /></IconButton><a href={`/api/file?track=${job.trackId}`} download aria-label={`Download ${jobTitle(job)}`} title="Save file" className="rounded-md p-2 text-white/38 hover:bg-white/8 hover:text-white"><IconDownload className="size-4" /></a></> : <IconButton label="Retry" onClick={onRetry}><IconRefresh className="size-4" /></IconButton>}
      </div>
    </div>
  );
}

function Artwork({ job }: { job: DownloadJob }) {
  const cover = job.metadata?.coverUrl || job.coverUrl;
  return <div className="grid size-11 place-items-center overflow-hidden rounded bg-white/[0.06] text-white/22">{cover ? <img src={cover} alt="" className="size-full object-cover" loading="lazy" /> : <IconMusic className="size-5" />}</div>;
}

function IconButton({ label, onClick, children, danger = false }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`rounded-md p-2 transition focus-visible:outline-none focus-visible:ring-2 ${danger ? "text-white/25 hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-red-400/40" : "text-white/38 hover:bg-white/8 hover:text-white focus-visible:ring-primary/40"}`}>{children}</button>;
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <div className="grid min-h-72 place-items-center px-5 py-8 text-center"><div><div className="mx-auto grid size-10 place-items-center rounded-full bg-white/[0.045] text-white/20 [&>svg]:size-5">{icon}</div><div className="mt-3 text-sm font-medium text-white/50">{title}</div><p className="mx-auto mt-1 max-w-72 text-xs leading-relaxed text-white/27">{body}</p></div></div>;
}

export function jobTitle(job: DownloadJob) { return job.metadata?.title || job.title || `Track ${job.trackId}`; }
export function jobArtist(job: DownloadJob) { return job.metadata?.artist || job.artist || "Unknown artist"; }

export function progressPercent(job: DownloadJob) {
  if (!job.expectedBytes || job.expectedBytes <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((job.bytesCaptured / job.expectedBytes) * 100)));
}

export function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function stateLabel(state: DownloadJob["state"]) {
  if (state === "capturing") return "Capturing";
  if (state === "transcoding") return "Encoding";
  if (state === "finalizing") return "Finalizing";
  if (state === "playing") return "Starting";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function stateDetail(job: DownloadJob) {
  if (job.state === "capturing" && job.durationMs) return `Capturing · ${Math.round(job.durationMs / 1000)} s source`;
  if (job.state === "transcoding") return `Encoding ${job.outputFormat || "mp3"}`;
  if (job.state === "finalizing") return "Validating captured stream";
  if (job.state === "queued") return "Waiting for capture instance";
  return stateLabel(job.state);
}
