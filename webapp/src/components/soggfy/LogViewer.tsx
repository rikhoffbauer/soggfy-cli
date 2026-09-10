import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IconExternalLink,
  IconFileText,
  IconPlayerPause,
  IconPlayerPlay,
  IconSearch,
} from "@tabler/icons-react";
import type {
  DownloadJob,
  InstanceSnapshot,
  LogSource,
  LogTailSnapshot,
} from "./models";

interface LogViewerProps {
  jobs: DownloadJob[];
  instances: InstanceSnapshot[];
}

const MEMORY_JOBS = "memory:jobs";
const MEMORY_INSTANCES = "memory:instances";

export function LogViewer({ jobs, instances }: LogViewerProps) {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diskLines, setDiskLines] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [paused, setPaused] = useState(false);
  const [frozenLines, setFrozenLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const memoryLines = useMemo(() => {
    if (selectedId === MEMORY_JOBS) {
      return jobs.flatMap((job) => job.logs.map((line) => `[job ${job.id} · ${job.trackId}] ${line}`));
    }
    if (selectedId === MEMORY_INSTANCES) {
      return instances.flatMap((instance) => instance.logs.map((line) => `[instance ${instance.id}] ${line}`));
    }
    return [];
  }, [instances, jobs, selectedId]);

  const selectedSource = sources.find((source) => source.id === selectedId) ?? null;
  const liveLines = selectedId?.startsWith("memory:") ? memoryLines : diskLines;
  const lines = paused && frozenLines ? frozenLines : liveLines;

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      try {
        const response = await fetch("/api/logs");
        const data = await response.json();
        if (cancelled || !response.ok) return;
        const nextSources = Array.isArray(data.sources) ? data.sources as LogSource[] : [];
        setSources(nextSources);
        setSelectedId((current) => {
          if (current && (current.startsWith("memory:") || nextSources.some((source) => source.id === current))) return current;
          return nextSources.find((source) => source.category === "daemon")?.id || nextSources[0]?.id || MEMORY_JOBS;
        });
      } catch {}
    };
    void loadCatalog();
    const timer = window.setInterval(loadCatalog, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedId || selectedId.startsWith("memory:") || paused) return;
    let cancelled = false;
    const loadLog = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/logs?source=${encodeURIComponent(selectedId)}&lines=1200`, { cache: "no-store" });
        const data = await response.json() as LogTailSnapshot & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "Failed to load log");
        setDiskLines(data.lines || []);
        setTruncated(Boolean(data.truncated));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load log");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadLog();
    const timer = window.setInterval(loadLog, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [paused, selectedId]);

  const filteredLines = useMemo(() => {
    if (!deferredQuery) return lines;
    return lines.filter((line) => line.toLowerCase().includes(deferredQuery));
  }, [deferredQuery, lines]);

  useEffect(() => {
    if (paused || deferredQuery) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [deferredQuery, filteredLines.length, paused, selectedId]);

  const chooseSource = (id: string) => {
    setSelectedId(id);
    setPaused(false);
    setFrozenLines(null);
    setDiskLines([]);
    setTruncated(false);
    setError(null);
  };

  const togglePause = () => {
    setPaused((current) => {
      if (!current) setFrozenLines([...liveLines]);
      else setFrozenLines(null);
      return !current;
    });
  };

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden border border-white/[0.055] bg-black/15">
      <div className="flex flex-col gap-2 border-b border-white/[0.055] p-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconFileText className="size-4 shrink-0 text-white/30" />
          <select
            aria-label="Log source"
            value={selectedId || ""}
            onChange={(event) => chooseSource(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-white/8 bg-[#15181c] px-2.5 py-1.5 text-xs text-white/70 outline-none focus:border-primary/40"
          >
            <option value={MEMORY_JOBS}>Job events (live)</option>
            <option value={MEMORY_INSTANCES}>Instance events (live)</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>{source.label}</option>
            ))}
          </select>
        </div>

        <label className="flex min-w-0 items-center gap-2 rounded-md border border-white/8 bg-white/[0.025] px-2.5 py-1.5 lg:w-64">
          <IconSearch className="size-3.5 shrink-0 text-white/25" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search logs"
            className="min-w-0 flex-1 bg-transparent text-xs text-white/70 outline-none placeholder:text-white/22"
          />
        </label>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={togglePause}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/8 px-2.5 text-xs text-white/50 transition hover:bg-white/[0.05] hover:text-white/75"
          >
            {paused ? <IconPlayerPlay className="size-3.5" /> : <IconPlayerPause className="size-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
          {selectedSource ? (
            <a
              href={`/api/logs?source=${encodeURIComponent(selectedSource.id)}&raw=1`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/8 px-2.5 text-xs text-white/50 transition hover:bg-white/[0.05] hover:text-white/75"
            >
              Raw log <IconExternalLink className="size-3.5" />
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-white/[0.045] px-3 py-2 text-[10px] text-white/27">
        <span>{filteredLines.length} visible / {lines.length} loaded{truncated ? " · tail truncated" : ""}</span>
        <span className="truncate text-right">
          {selectedSource ? `${formatBytes(selectedSource.sizeBytes)} · ${formatTime(selectedSource.modifiedAt)}` : paused ? "paused" : "live memory"}
        </span>
      </div>

      {error ? <div className="border-b border-red-400/10 bg-red-400/[0.04] px-3 py-2 text-xs text-red-200/70">{error}</div> : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto bg-[#0d0f12] font-mono text-[11px] leading-5 text-white/55"
      >
        {filteredLines.length ? (
          <pre className="min-w-max whitespace-pre px-3 py-2 [content-visibility:auto]">
            {filteredLines.join("\n")}
          </pre>
        ) : (
          <div className="grid min-h-48 place-items-center px-4 text-center text-xs text-white/25">
            {loading ? "Loading log…" : deferredQuery ? "No matching log lines." : "No log lines yet."}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
