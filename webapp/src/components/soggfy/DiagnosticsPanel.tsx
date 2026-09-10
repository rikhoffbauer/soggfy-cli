import { IconServer } from "@tabler/icons-react";
import type { DownloadJob, HealthSnapshot, InstanceSnapshot } from "./models";
import { LogViewer } from "./LogViewer";

interface DiagnosticsPanelProps {
  health: HealthSnapshot | null;
  instances: InstanceSnapshot[];
  jobs: DownloadJob[];
}

export function DiagnosticsPanel({ health, instances, jobs }: DiagnosticsPanelProps) {
  const ready = health?.readyInstances ?? instances.filter((item) => item.isReady).length;
  const total = health?.poolSize ?? instances.length;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Diagnostics</h1>
        <p className="mt-1 text-sm text-white/40">Runtime health, capture instances, and live logs.</p>
      </div>
      <div className="mt-4 grid shrink-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Server" value={health?.started ? "Running" : "Starting"} />
        <Metric label="Instances" value={`${ready}/${total} ready`} />
        <Metric label="Active jobs" value={String(health?.activeJobs ?? 0)} />
        <Metric label="Completed / failed" value={`${health?.completedJobs ?? 0} / ${health?.failedJobs ?? 0}`} />
      </div>
      {instances.length ? (
        <div className="mt-3 shrink-0 overflow-hidden border-y border-white/[0.055]">
          {instances.map((instance) => (
            <div key={instance.id} className="grid gap-2 border-b border-white/[0.05] px-3 py-2 last:border-b-0 sm:grid-cols-[150px_1fr_auto] sm:items-center">
              <div className="flex items-center gap-2 text-xs font-semibold text-white/65"><IconServer className="size-3.5 text-white/30" /> Instance {instance.id}</div>
              <div className="min-w-0 truncate text-xs text-white/35" title={instance.lastError || instance.statusText}>{instance.lastError ? `Error: ${instance.lastError}` : instance.statusText || "Idle"}</div>
              <div className="flex items-center gap-2 text-[10px] text-white/35"><span className={`size-1.5 rounded-full ${instance.isReady ? "bg-primary" : "bg-red-400"}`} />{instance.isBusy ? "busy" : instance.isReady ? "ready" : "offline"}<span className="text-white/20">:{instance.debugPort}</span></div>
            </div>
          ))}
        </div>
      ) : null}
      <LogViewer jobs={jobs} instances={instances} />
      {health?.outputDir ? <div className="mt-2 shrink-0 truncate text-[10px] text-white/22" title={health.outputDir}>Output: {health.outputDir}</div> : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border border-white/[0.055] bg-white/[0.025] px-3 py-2.5"><div className="text-[10px] uppercase tracking-wide text-white/25">{label}</div><div className="mt-1 text-sm font-semibold text-white/65">{value}</div></div>;
}
