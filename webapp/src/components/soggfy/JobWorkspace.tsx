import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconHistory,
  IconLoader2,
  IconMusic,
  IconPlayerPlay,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { DownloadJob } from "./models";

interface JobWorkspaceProps {
  queue: DownloadJob[];
  library: DownloadJob[];
  onAction: (jobId: string, action: "cancel" | "retry") => void;
  onPlay: (job: DownloadJob) => void;
}

export function JobWorkspace({ queue, library, onAction, onPlay }: JobWorkspaceProps) {
  const completed = library.filter((job) => job.state === "completed");

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,.92fr)]">
      <section id="queue" className="scroll-mt-4 overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-white/90">Download queue</h2>
            <p className="mt-0.5 text-xs text-white/35">{queue.length ? `${queue.length} active ${queue.length === 1 ? "job" : "jobs"}` : "Nothing waiting"}</p>
          </div>
          {queue.length ? <span className="rounded-full bg-primary/12 px-2 py-1 text-[11px] font-semibold text-primary">{queue.length}</span> : null}
        </header>

        <div className="min-h-44">
          {queue.length ? queue.map((job) => (
            <QueueRow key={job.id} job={job} onCancel={() => onAction(job.id, "cancel")} />
          )) : (
            <EmptyState icon={<IconDownload />} title="Queue is clear" body="Search above or paste a Spotify URL to add music." />
          )}
        </div>
      </section>

      <section id="library" className="scroll-mt-4 overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-white/90">Recent downloads</h2>
            <p className="mt-0.5 text-xs text-white/35">Completed files and recent attempts</p>
          </div>
          {completed.length > 1 ? (
            <a href="/api/download-all" className="shrink-0">
              <Button size="sm" variant="ghost" className="h-8 text-xs text-white/55 hover:text-white">
                <IconDownload className="size-3.5" /> ZIP all
              </Button>
            </a>
          ) : null}
        </header>

        <div className="max-h-[420px] overflow-y-auto">
          {library.length ? library.map((job) => (
            <LibraryRow key={job.id} job={job} onRetry={() => onAction(job.id, "retry")} onPlay={() => onPlay(job)} />
          )) : (
            <EmptyState icon={<IconHistory />} title="No downloads yet" body="Finished downloads will stay available here." />
          )}
        </div>
      </section>
    </div>
  );
}

function QueueRow({ job, onCancel }: { job: DownloadJob; onCancel: () => void }) {
  const pct = progressPercent(job);
  const indeterminate = !job.expectedBytes || job.expectedBytes <= 0;

  return (
    <div className="border-b border-white/[0.055] px-4 py-3.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <Artwork job={job} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white/90">{jobTitle(job)}</div>
              <div className="mt-0.5 truncate text-xs text-white/38">{jobArtist(job)}</div>
            </div>
            <button
              type="button"
              aria-label={`Cancel ${jobTitle(job)}`}
              title="Cancel download"
              onClick={onCancel}
              className="rounded-md p-1.5 text-white/25 transition hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
            >
              <IconX className="size-4" />
            </button>
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
              <div
                className={`h-full rounded-full bg-primary transition-[width] duration-500 ${indeterminate ? "soggfy-progress-indeterminate w-1/3" : ""}`}
                style={indeterminate ? undefined : { width: `${pct}%` }}
              />
            </div>
            <span className="min-w-10 text-right text-[10px] tabular-nums text-white/35">{indeterminate ? stateLabel(job.state) : `${pct}%`}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-white/28">
            <span>{stateDetail(job)}</span>
            {job.bytesCaptured > 0 ? <span className="tabular-nums">{formatBytes(job.bytesCaptured)}{job.expectedBytes ? ` / ${formatBytes(job.expectedBytes)}` : ""}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryRow({ job, onRetry, onPlay }: { job: DownloadJob; onRetry: () => void; onPlay: () => void }) {
  const completed = job.state === "completed";
  return (
    <div className="group border-b border-white/[0.055] px-4 py-3 last:border-b-0 hover:bg-white/[0.025]">
      <div className="flex items-center gap-3">
        <Artwork job={job} compact />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white/85">{jobTitle(job)}</div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/35">
            <span className="truncate">{jobArtist(job)}</span>
            {completed && job.sizeBytes ? <><span>·</span><span>{formatBytes(job.sizeBytes)}</span></> : null}
          </div>
          {!completed && job.error ? <div className="mt-1 truncate text-[10px] text-red-300/70" title={job.error}>{job.error}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {completed ? (
            <>
              <IconCheck className="mr-1 size-4 text-primary" aria-label="Completed" />
              <IconButton label="Play" onClick={onPlay}><IconPlayerPlay className="size-4" /></IconButton>
              <a href={`/api/file?track=${job.trackId}`} download aria-label={`Download ${jobTitle(job)}`} title="Save file" className="rounded-md p-2 text-white/38 transition hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <IconDownload className="size-4" />
              </a>
            </>
          ) : (
            <>
              <IconAlertTriangle className="mr-1 size-4 text-amber-300/70" />
              <IconButton label="Retry" onClick={onRetry}><IconRefresh className="size-4" /></IconButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Artwork({ job, compact = false }: { job: DownloadJob; compact?: boolean }) {
  const cover = job.metadata?.coverUrl || job.coverUrl;
  const size = compact ? "size-10" : "size-12";
  return (
    <div className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.06] text-white/22`}>
      {cover ? <img src={cover} alt="" className="size-full object-cover" loading="lazy" /> : <IconMusic className="size-5" />}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md p-2 text-white/38 transition hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {children}
    </button>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="grid min-h-44 place-items-center px-5 py-8 text-center">
      <div>
        <div className="mx-auto grid size-9 place-items-center rounded-full bg-white/[0.045] text-white/20 [&>svg]:size-[18px]">{icon}</div>
        <div className="mt-3 text-sm font-medium text-white/50">{title}</div>
        <p className="mx-auto mt-1 max-w-56 text-xs leading-relaxed text-white/27">{body}</p>
      </div>
    </div>
  );
}

export function jobTitle(job: DownloadJob) {
  return job.metadata?.title || job.title || `Track ${job.trackId}`;
}

export function jobArtist(job: DownloadJob) {
  return job.metadata?.artist || job.artist || "Unknown artist";
}

export function progressPercent(job: DownloadJob) {
  if (!job.expectedBytes || job.expectedBytes <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((job.bytesCaptured / job.expectedBytes) * 100)));
}

export function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function stateLabel(state: DownloadJob["state"]) {
  if (state === "capturing") return "Capturing";
  if (state === "transcoding") return "Encoding";
  if (state === "finalizing") return "Finalizing";
  if (state === "playing") return "Starting";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function stateDetail(job: DownloadJob) {
  if (job.state === "capturing" && job.durationMs) return `Capturing audio · ${Math.round(job.durationMs / 1000)} s source`;
  if (job.state === "transcoding") return `Encoding ${job.outputFormat || "mp3"} and writing metadata`;
  if (job.state === "finalizing") return "Validating captured stream";
  if (job.state === "queued") return "Waiting for a capture instance";
  if (job.instanceId) return `${stateLabel(job.state)} on instance ${job.instanceId}`;
  return stateLabel(job.state);
}
