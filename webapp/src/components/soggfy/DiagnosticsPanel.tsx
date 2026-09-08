import { useState } from "react";
import {
  IconActivityHeartbeat,
  IconChevronDown,
  IconServer,
} from "@tabler/icons-react";
import type { HealthSnapshot, InstanceSnapshot } from "./models";
import { DEFAULT_DIAGNOSTICS_OPEN } from "./workspace-model";

interface DiagnosticsPanelProps {
  health: HealthSnapshot | null;
  instances: InstanceSnapshot[];
}

export function DiagnosticsPanel({ health, instances }: DiagnosticsPanelProps) {
  const [open, setOpen] = useState(DEFAULT_DIAGNOSTICS_OPEN);
  const ready = health?.readyInstances ?? instances.filter((item) => item.isReady).length;
  const total = health?.poolSize ?? instances.length;

  return (
    <section id="diagnostics" className="scroll-mt-4 overflow-hidden rounded-xl border border-white/8 bg-white/[0.02]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.055] text-white/45">
          <IconActivityHeartbeat className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white/75">Diagnostics</div>
          <div className="mt-0.5 truncate text-xs text-white/30">
            {health?.started ? `${ready}/${total} instances ready · ${health.activeJobs ?? 0} active` : "Server starting"}
          </div>
        </div>
        <IconChevronDown className={`size-4 text-white/30 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="border-t border-white/[0.055] p-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Server" value={health?.started ? "Running" : "Starting"} />
            <Metric label="Instances" value={`${ready}/${total} ready`} />
            <Metric label="Active jobs" value={String(health?.activeJobs ?? 0)} />
            <Metric label="Completed / failed" value={`${health?.completedJobs ?? 0} / ${health?.failedJobs ?? 0}`} />
          </div>

          {instances.length ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-white/[0.055]">
              {instances.map((instance) => (
                <div key={instance.id} className="grid gap-2 border-b border-white/[0.05] px-3 py-2.5 last:border-b-0 sm:grid-cols-[150px_1fr_auto] sm:items-center">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white/65">
                    <IconServer className="size-3.5 text-white/30" /> Instance {instance.id}
                  </div>
                  <div className="min-w-0 truncate text-xs text-white/35" title={instance.lastError || instance.statusText}>
                    {instance.lastError ? `Error: ${instance.lastError}` : instance.statusText || "Idle"}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-white/35">
                    <span className={`size-1.5 rounded-full ${instance.isReady ? "bg-primary" : "bg-red-400"}`} />
                    {instance.isBusy ? "busy" : instance.isReady ? "ready" : "offline"}
                    <span className="text-white/20">:{instance.debugPort}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {health?.outputDir ? (
            <div className="mt-3 truncate text-[10px] text-white/22" title={health.outputDir}>Output: {health.outputDir}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.035] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-white/25">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white/65">{value}</div>
    </div>
  );
}
