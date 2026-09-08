import { useEffect, useMemo, useState } from "react";
import { IconBook2, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { AppSidebar } from "./components/soggfy/AppSidebar";
import { DiagnosticsPanel } from "./components/soggfy/DiagnosticsPanel";
import { JobWorkspace } from "./components/soggfy/JobWorkspace";
import type {
  DownloadJob,
  HealthSnapshot,
  JobsSnapshot,
  SearchResult,
} from "./components/soggfy/models";
import { PlayerBar } from "./components/soggfy/PlayerBar";
import { SearchPanel } from "./components/soggfy/SearchPanel";
import { partitionJobs } from "./components/soggfy/workspace-model";
import logo from "./logo.png";

const EMPTY_SNAPSHOT: JobsSnapshot = { jobs: [], queue: [], instances: [] };
const DOCS_URL = "https://rikhoffbauer.github.io/soggfy-cli/";

export function App() {
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<JobsSnapshot>(EMPTY_SNAPSHOT);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playerTrackId, setPlayerTrackId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [jobsResponse, healthResponse] = await Promise.all([
          fetch("/api/jobs"),
          fetch("/api/health"),
        ]);
        if (cancelled) return;
        if (jobsResponse.ok) setSnapshot(await jobsResponse.json());
        if (healthResponse.ok) setHealth(await healthResponse.json());
      } catch {
        // Keep the last good snapshot; diagnostics exposes server readiness.
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const { queue, library } = useMemo(() => partitionJobs(snapshot.jobs), [snapshot.jobs]);
  const completedCount = library.filter((job) => job.state === "completed").length;
  const playerJob = playerTrackId
    ? snapshot.jobs.find((job) => job.trackId === playerTrackId && job.state === "completed") || null
    : null;

  const queueDownload = async (input: string) => {
    setSearchError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: input }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to queue download");
      const count = Number(data.count || 1);
      setNotice(count > 1 ? `Queued ${count} tracks.` : "Download queued.");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to queue download");
    }
  };

  const submitSearch = async (value: string) => {
    setSearching(true);
    setSearchError(null);
    setNotice(null);
    try {
      if (looksLikeSpotifyInput(value)) {
        await queueDownload(value);
        setQuery("");
        return;
      }
      const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Spotify search failed");
      const results = Array.isArray(data.results) ? data.results : [];
      setSearchResults(results);
      if (!results.length) setNotice("No Spotify results found.");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Spotify search failed");
    } finally {
      setSearching(false);
    }
  };

  const runJobAction = async (jobId: string, action: "cancel" | "retry") => {
    setSearchError(null);
    try {
      const response = await fetch("/api/jobs/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || `Failed to ${action} job`);
      setNotice(action === "cancel" ? "Download cancelled." : "Retry queued.");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : `Failed to ${action} job`);
    }
  };

  const ready = Boolean(health?.started && (health.readyInstances ?? 0) > 0);

  return (
    <div className="dark flex min-h-screen w-full bg-[#101215] text-foreground selection:bg-primary/30">
      <AppSidebar queueCount={queue.length} libraryCount={completedCount} health={health} />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center border-b border-white/8 bg-[#101215]/90 px-4 backdrop-blur-xl lg:hidden">
          <a href="#search" className="flex items-center gap-2.5 font-bold text-white">
            <img src={logo} alt="" className="size-7 rounded-lg" /> Soggfy
          </a>
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-white/40">
              <span className={`size-1.5 rounded-full ${ready ? "bg-primary" : "bg-amber-400"}`} />
              {ready ? "Ready" : "Starting"}
            </span>
            <a href={DOCS_URL} target="_blank" rel="noreferrer" aria-label="Documentation" className="rounded-md p-1.5 text-white/40 hover:bg-white/8 hover:text-white">
              <IconBook2 className="size-4" />
            </a>
          </div>
        </header>

        <main className={`mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 xl:px-8 ${playerJob ? "pb-28" : "pb-10"}`}>
          <SearchPanel
            query={query}
            results={searchResults}
            loading={searching}
            error={searchError}
            onQueryChange={setQuery}
            onSubmit={submitSearch}
            onQueue={queueDownload}
          />

          {notice ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/15 bg-primary/[0.06] px-3 py-2 text-xs text-primary/90">
              <IconCheck className="size-3.5" /> {notice}
            </div>
          ) : null}

          {!health?.started ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.055] px-3 py-2 text-xs text-amber-100/70">
              <IconLoader2 className="size-3.5 animate-spin" /> Capture server is starting. Search remains available while instances initialize.
            </div>
          ) : null}

          <div className="mt-6">
            <JobWorkspace
              queue={queue}
              library={library}
              onAction={runJobAction}
              onPlay={(job: DownloadJob) => setPlayerTrackId(job.trackId)}
            />
          </div>

          <div className="mt-5">
            <DiagnosticsPanel health={health} instances={snapshot.instances} />
          </div>
        </main>
      </div>

      <PlayerBar job={playerJob} onClose={() => setPlayerTrackId(null)} />
    </div>
  );
}

function looksLikeSpotifyInput(value: string) {
  const trimmed = value.trim();
  return trimmed.includes("open.spotify.com/")
    || trimmed.startsWith("spotify:")
    || /^[a-zA-Z0-9]{22}$/.test(trimmed);
}

export default App;
