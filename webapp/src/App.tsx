import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IconMusic,
  IconDownload,
  IconAlertCircle,
  IconCheck,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerSkipForward,
  IconPlayerSkipBack,
  IconVolume,
  IconVolume2,
  IconVolume3,
  IconFolderDown,
  IconSearch,
  IconActivity,
  IconServer,
  IconRefresh,
  IconX,
  IconRotateClockwise,
  IconHeartbeat,
} from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import logo from "./logo.png";

type DownloadState =
  | "queued"
  | "assigned"
  | "starting"
  | "playing"
  | "capturing"
  | "finalizing"
  | "transcoding"
  | "completed"
  | "failed"
  | "cancelled";

interface DownloadJob {
  id: string;
  trackId: string;
  state: DownloadState;
  legacyStatus: "pending" | "downloading" | "completed" | "failed";
  instanceId?: number;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  bytesCaptured: number;
  expectedBytes?: number;
  durationMs?: number;
  outputFormat?: "wav" | "ogg" | "mp3";
  sizeBytes?: number;
  error?: string;
  title?: string;
  artist?: string;
  coverUrl?: string;
  metadata?: {
    title?: string;
    artist?: string;
    coverUrl?: string;
  };
  validation?: {
    warnings: string[];
    rms?: number;
    peak?: number;
    silenceRatio?: number;
    ffprobeOk?: boolean;
    actualDataBytes?: number;
    durationMs?: number;
  };
  logs: string[];
}

interface InstanceSnapshot {
  id: number;
  socketPath: string;
  savePath: string;
  profileDir: string;
  debugPort: number;
  isReady: boolean;
  isBusy: boolean;
  currentTrack: string | null;
  currentJobId: string | null;
  statusText: string;
  lastHeartbeatAt?: string;
  lastError?: string;
  logs: string[];
}

interface JobsSnapshot {
  jobs: DownloadJob[];
  queue: string[];
  instances: InstanceSnapshot[];
}

interface HealthSnapshot {
  ok: boolean;
  started: boolean;
  repoRoot: string;
  outputDir: string;
  poolSize: number;
  readyInstances: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
}

function jobTitle(job?: DownloadJob | null) {
  if (!job) return "Unknown Track";
  return job.metadata?.title || job.title || `Track ${job.trackId}`;
}

function jobArtist(job?: DownloadJob | null) {
  return job?.metadata?.artist || job?.artist || "Unknown Artist";
}

function jobCover(job?: DownloadJob | null) {
  return job?.metadata?.coverUrl || job?.coverUrl;
}

function formatTime(time: number) {
  if (!Number.isFinite(time)) return "0:00";
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function progressPercent(job: DownloadJob) {
  if (!job.expectedBytes || job.expectedBytes <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((job.bytesCaptured / job.expectedBytes) * 100)));
}

function stateTone(state: DownloadState) {
  switch (state) {
    case "completed": return "text-green-400 border-green-500/40 bg-green-500/10";
    case "failed": return "text-red-400 border-red-500/40 bg-red-500/10";
    case "cancelled": return "text-slate-400 border-slate-500/40 bg-slate-500/10";
    case "capturing": return "text-purple-300 border-purple-500/40 bg-purple-500/10";
    case "transcoding": return "text-blue-300 border-blue-500/40 bg-blue-500/10";
    default: return "text-amber-300 border-amber-500/40 bg-amber-500/10";
  }
}

export function App() {
  const [url, setUrl] = useState("");
  const [snapshot, setSnapshot] = useState<JobsSnapshot>({ jobs: [], queue: [], instances: [] });
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [jobsRes, healthRes] = await Promise.all([fetch("/api/jobs"), fetch("/api/health")]);
        if (!cancelled && jobsRes.ok) setSnapshot(await jobsRes.json());
        if (!cancelled && healthRes.ok) setHealth(await healthRes.json());
      } catch (err) {
        console.error("Failed to fetch operational status", err);
      }
    }
    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const jobs = snapshot.jobs;
  const currentTrack = jobs.find((job) => job.trackId === currentTrackId) || null;
  const completedCount = jobs.filter((job) => job.state === "completed").length;

  const queueDownload = async (downloadUrl: string) => {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: downloadUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to queue download");

      setUrl("");
      setSearchResults([]);
      setSuccessMsg(data.count > 1 ? `Queued ${data.count} tracks.` : "Track queued.");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setSearchResults([]);

    try {
      const isUrlOrId = url.includes("spotify.com") || url.startsWith("spotify:") || /^[a-zA-Z0-9]{22}$/.test(url);
      if (isUrlOrId) {
        await queueDownload(url);
        return;
      }

      const res = await fetch(`/api/search?q=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to search");
      const items = [
        ...(data.tracks?.items || []),
        ...(data.albums?.items || []),
        ...(data.playlists?.items || []),
      ];
      setSearchResults(items.filter((item: any) => item !== null));
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const runJobAction = async (jobId: string, action: "cancel" | "retry") => {
    setError(null);
    try {
      const res = await fetch("/api/jobs/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Failed to ${action} job`);
      setSuccessMsg(action === "cancel" ? "Job cancelled." : "Retry queued.");
    } catch (err: any) {
      setError(err.message || `Failed to ${action} job`);
    }
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
  };

  const playTrack = (trackId: string) => {
    if (currentTrackId === trackId) {
      handlePlayPause();
      return;
    }
    setCurrentTrackId(trackId);
    setIsPlaying(true);
    if (audioRef.current) {
      audioRef.current.src = `/api/stream?track=${trackId}`;
      audioRef.current.play();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number.parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setProgress(val);
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number.parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) audioRef.current.volume = val;
  };

  return (
    <div className="dark min-h-screen bg-linear-to-br from-slate-950 via-purple-950/20 to-slate-950 text-foreground font-sans selection:bg-purple-500/30">
      <div className="container max-w-6xl mx-auto p-4 sm:p-8 pb-32 relative z-10 flex flex-col gap-6">
        <div className="text-center space-y-3 py-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="inline-flex items-center justify-center p-3 bg-purple-500/10 rounded-2xl ring-1 ring-purple-500/20 mb-2 shadow-2xl shadow-purple-500/20">
            <img src={logo} alt="logo" className="size-12 drop-shadow-lg" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-linear-to-r from-purple-400 to-pink-500">
            Soggfy
          </h1>
          <p className="text-lg text-slate-400 font-medium max-w-2xl mx-auto">
            Supervised capture queue with explicit job state, instance health, validation output, and recovery controls.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border-slate-800 bg-black/35 backdrop-blur-xl">
            <CardHeader className="pb-2"><CardDescription>Server</CardDescription><CardTitle className="flex items-center gap-2 text-lg"><IconHeartbeat className="size-5" />{health?.started ? "Started" : "Starting"}</CardTitle></CardHeader>
          </Card>
          <Card className="border-slate-800 bg-black/35 backdrop-blur-xl">
            <CardHeader className="pb-2"><CardDescription>Instances</CardDescription><CardTitle className="text-lg">{health?.readyInstances ?? 0}/{health?.poolSize ?? snapshot.instances.length} ready</CardTitle></CardHeader>
          </Card>
          <Card className="border-slate-800 bg-black/35 backdrop-blur-xl">
            <CardHeader className="pb-2"><CardDescription>Active jobs</CardDescription><CardTitle className="text-lg">{health?.activeJobs ?? 0}</CardTitle></CardHeader>
          </Card>
          <Card className="border-slate-800 bg-black/35 backdrop-blur-xl">
            <CardHeader className="pb-2"><CardDescription>Completed / failed</CardDescription><CardTitle className="text-lg">{health?.completedJobs ?? 0} / {health?.failedJobs ?? 0}</CardTitle></CardHeader>
          </Card>
        </div>

        <Card className="shadow-2xl border-purple-500/20 bg-black/40 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
          <CardHeader>
            <CardTitle className="text-xl">Add to Queue</CardTitle>
            <CardDescription className="text-slate-400">Paste a Spotify track, album, playlist URL, URI, ID, or search query.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 group">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-purple-400 transition-colors">
                  <IconSearch className="size-5" />
                </div>
                <Input
                  type="text"
                  placeholder="https://open.spotify.com/... or search text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                  className="pl-10 h-12 bg-slate-900/50 border-slate-800 focus:border-purple-500/50 focus:ring-purple-500/20 transition-all text-base"
                />
              </div>
              <Button type="submit" disabled={loading || !url} className="h-12 px-8 bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-600/20 transition-all">
                {loading ? <><IconLoader2 className="mr-2 size-5 animate-spin" />Resolving</> : <><IconDownload className="mr-2 size-5" />Queue</>}
              </Button>
            </form>

            {error && (
              <Alert variant="destructive" className="mt-4 bg-red-950/50 border-red-900/50">
                <IconAlertCircle className="size-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {successMsg && (
              <Alert className="mt-4 border-green-500/50 bg-green-950/30 text-green-400">
                <IconCheck className="size-4 stroke-current" />
                <AlertTitle>OK</AlertTitle>
                <AlertDescription>{successMsg}</AlertDescription>
              </Alert>
            )}

            {searchResults.length > 0 && (
              <div className="mt-6">
                <h3 className="text-lg font-semibold text-white mb-3">Search Results</h3>
                <ScrollArea className="h-64 rounded-md border border-slate-800 bg-slate-900/50">
                  <div className="divide-y divide-slate-800/50">
                    {searchResults.map((item) => {
                      const cover = item.album?.images?.[0]?.url || item.images?.[0]?.url;
                      const artist = item.artists?.map((a: any) => a.name).join(", ") || item.owner?.display_name || "Unknown";
                      return (
                        <div key={item.id} className="p-3 flex items-center justify-between hover:bg-slate-800/50 transition-colors">
                          <div className="flex items-center gap-3 overflow-hidden">
                            {cover ? <img src={cover} className="size-10 rounded shadow-md object-cover shrink-0" alt="cover" /> : <div className="size-10 rounded bg-slate-800 flex items-center justify-center shrink-0"><IconMusic className="size-5 text-slate-600" /></div>}
                            <div className="flex flex-col truncate">
                              <span className="font-medium text-slate-200 truncate">{item.name}</span>
                              <span className="text-sm text-slate-500 truncate">{artist} • {item.type}</span>
                            </div>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => queueDownload(item.external_urls?.spotify || item.uri || item.id)} className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10">
                            Queue
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <Card className="border-slate-800 bg-black/40 backdrop-blur-xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-800/60">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/10 rounded-lg"><IconActivity className="size-5 text-purple-400" /></div>
                <div>
                  <CardTitle className="text-xl">Jobs</CardTitle>
                  <CardDescription>{jobs.length} total, {snapshot.queue.length} queued</CardDescription>
                </div>
              </div>
              {completedCount > 0 && (
                <a href="/api/download-all" className="inline-flex">
                  <Button size="sm" className="h-8 px-3 bg-green-600/20 text-green-400 hover:bg-green-600/30 hover:text-green-300 border border-green-500/30 transition-all group">
                    <IconFolderDown className="size-4 mr-1.5 group-hover:-translate-y-0.5 transition-transform" />Zip All
                  </Button>
                </a>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[620px]">
                {jobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[400px] text-slate-500 gap-4">
                    <div className="size-20 rounded-full bg-slate-800/50 flex items-center justify-center"><IconMusic className="size-10 text-slate-600" /></div>
                    <p className="text-lg">No jobs yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/50">
                    {jobs.map((job) => {
                      const pct = progressPercent(job);
                      const cover = jobCover(job);
                      const expanded = expandedJobId === job.id;
                      return (
                        <div key={job.id} className="p-4 sm:px-6 hover:bg-slate-800/30 transition-colors">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4 overflow-hidden min-w-0">
                              <div className="relative size-14 bg-slate-800 rounded-xl overflow-hidden shadow-lg shrink-0 flex items-center justify-center group-hover:ring-2 ring-purple-500/50 transition-all">
                                {cover ? <img src={cover} alt="cover" className="w-full h-full object-cover" /> : <IconMusic className="size-6 text-slate-600" />}
                                {job.state === "completed" && (
                                  <button onClick={() => playTrack(job.trackId)} className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity">
                                    {currentTrackId === job.trackId && isPlaying ? <IconPlayerPause className="size-6 text-white drop-shadow-md" /> : <IconPlayerPlay className="size-6 text-white drop-shadow-md ml-1" />}
                                  </button>
                                )}
                              </div>
                              <div className="flex flex-col truncate min-w-0">
                                <button onClick={() => setExpandedJobId(expanded ? null : job.id)} className="font-semibold text-base text-slate-200 truncate text-left hover:text-white">
                                  {jobTitle(job)}
                                </button>
                                <p className="text-sm text-slate-400 truncate mt-0.5">{jobArtist(job)}</p>
                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                  <Badge variant="outline" className={stateTone(job.state)}>{job.state}</Badge>
                                  {job.instanceId && <Badge variant="outline" className="border-slate-700 text-slate-400">instance {job.instanceId}</Badge>}
                                  {job.outputFormat && <Badge variant="outline" className="border-slate-700 text-slate-400">{job.outputFormat}</Badge>}
                                  {job.validation?.warnings?.length ? <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10">{job.validation.warnings.length} warnings</Badge> : null}
                                  {job.error && <span className="text-xs text-red-300 truncate max-w-[340px]">{job.error}</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {job.state === "completed" && (
                                <>
                                  <Button variant="ghost" size="icon" onClick={() => playTrack(job.trackId)} className="h-9 w-9 text-slate-400 hover:text-white hover:bg-purple-500/20 rounded-full transition-colors">
                                    {currentTrackId === job.trackId && isPlaying ? <IconPlayerPause className="size-5" /> : <IconPlayerPlay className="size-5" />}
                                  </Button>
                                  <a href={`/api/file?track=${job.trackId}`} download>
                                    <Button variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-white hover:bg-purple-500/20 rounded-full transition-colors"><IconDownload className="size-5" /></Button>
                                  </a>
                                </>
                              )}
                              {(job.state === "failed" || job.state === "cancelled") && (
                                <Button variant="ghost" size="icon" onClick={() => runJobAction(job.id, "retry")} className="h-9 w-9 text-slate-400 hover:text-white hover:bg-blue-500/20 rounded-full transition-colors"><IconRotateClockwise className="size-5" /></Button>
                              )}
                              {!["completed", "failed", "cancelled"].includes(job.state) && (
                                <Button variant="ghost" size="icon" onClick={() => runJobAction(job.id, "cancel")} className="h-9 w-9 text-slate-400 hover:text-white hover:bg-red-500/20 rounded-full transition-colors"><IconX className="size-5" /></Button>
                              )}
                            </div>
                          </div>

                          {job.expectedBytes ? (
                            <div className="mt-3">
                              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                <div className="h-full bg-purple-500 transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <div className="mt-1 flex justify-between text-xs text-slate-500">
                                <span>{pct}%</span>
                                <span>{formatBytes(job.bytesCaptured)} / {formatBytes(job.expectedBytes)}</span>
                              </div>
                            </div>
                          ) : job.bytesCaptured > 0 ? (
                            <div className="mt-2 text-xs text-slate-500">Captured {formatBytes(job.bytesCaptured)}</div>
                          ) : null}

                          {expanded && (
                            <div className="mt-4 grid md:grid-cols-2 gap-3 text-xs">
                              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1 text-slate-400">
                                <div><span className="text-slate-500">Job:</span> {job.id}</div>
                                <div><span className="text-slate-500">Track:</span> {job.trackId}</div>
                                <div><span className="text-slate-500">Attempts:</span> {job.attempts}</div>
                                <div><span className="text-slate-500">Updated:</span> {new Date(job.updatedAt).toLocaleTimeString()}</div>
                                <div><span className="text-slate-500">Size:</span> {formatBytes(job.sizeBytes)}</div>
                                {job.validation && <div><span className="text-slate-500">Signal:</span> rms={job.validation.rms?.toExponential(2) ?? "n/a"}, peak={job.validation.peak?.toFixed(3) ?? "n/a"}, silence={job.validation.silenceRatio != null ? `${Math.round(job.validation.silenceRatio * 100)}%` : "n/a"}</div>}
                              </div>
                              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                <div className="font-medium text-slate-300 mb-2">Recent log</div>
                                <div className="space-y-1 text-slate-500 max-h-28 overflow-hidden">
                                  {(job.logs || []).slice(-5).map((line) => <div key={line} className="truncate">{line}</div>)}
                                </div>
                                {job.validation?.warnings?.length ? <div className="mt-2 text-amber-300">Warnings: {job.validation.warnings.join(", ")}</div> : null}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-black/40 backdrop-blur-xl overflow-hidden">
            <CardHeader className="border-b border-slate-800/60">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/10 rounded-lg"><IconServer className="size-5 text-purple-400" /></div>
                <div>
                  <CardTitle className="text-xl">Instances</CardTitle>
                  <CardDescription>Socket, profile, and watchdog state</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[620px]">
                <div className="divide-y divide-slate-800/50">
                  {snapshot.instances.map((instance) => (
                    <div key={instance.id} className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-200">Instance {instance.id}</div>
                        <Badge variant="outline" className={instance.isReady ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-red-500/40 text-red-400 bg-red-500/10"}>{instance.isReady ? "ready" : "not ready"}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                        <div>Busy: <span className="text-slate-300">{instance.isBusy ? "yes" : "no"}</span></div>
                        <div>Port: <span className="text-slate-300">{instance.debugPort}</span></div>
                        <div className="col-span-2 truncate">Status: <span className="text-slate-300">{instance.statusText}</span></div>
                        <div className="col-span-2 truncate">Track: <span className="text-slate-300">{instance.currentTrack || "—"}</span></div>
                        <div className="col-span-2 truncate">Socket: <span className="text-slate-300">{instance.socketPath}</span></div>
                        {instance.lastHeartbeatAt && <div className="col-span-2 truncate">Heartbeat: <span className="text-slate-300">{new Date(instance.lastHeartbeatAt).toLocaleTimeString()}</span></div>}
                        {instance.lastError && <div className="col-span-2 text-red-300">{instance.lastError}</div>}
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs text-slate-500 space-y-1">
                        {(instance.logs || []).slice(-4).map((line) => <div key={line} className="truncate">{line}</div>)}
                      </div>
                    </div>
                  ))}
                  {snapshot.instances.length === 0 && <div className="p-6 text-slate-500">No instances reported yet.</div>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-2xl border-t border-slate-800 p-3 px-6 transition-transform duration-500 ease-out z-50 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] ${currentTrackId ? "translate-y-0" : "translate-y-full"}`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 w-1/3 min-w-[200px] overflow-hidden">
            {jobCover(currentTrack) ? <img src={jobCover(currentTrack)} className="size-14 rounded-md shadow-md object-cover" alt="cover" /> : <div className="size-14 rounded-md bg-slate-800 flex items-center justify-center shrink-0"><IconMusic className="size-6 text-slate-600" /></div>}
            <div className="flex flex-col truncate">
              <span className="font-bold text-white truncate">{jobTitle(currentTrack)}</span>
              <span className="text-sm text-slate-400 truncate">{jobArtist(currentTrack)}</span>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center w-1/3 max-w-[500px]">
            <div className="flex items-center gap-6 mb-2">
              <button className="text-slate-400 hover:text-white transition-colors" disabled><IconPlayerSkipBack className="size-5 fill-current" /></button>
              <button onClick={handlePlayPause} className="size-10 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 transition-transform">
                {isPlaying ? <IconPlayerPause className="size-5 fill-current" /> : <IconPlayerPlay className="size-5 fill-current ml-0.5" />}
              </button>
              <button className="text-slate-400 hover:text-white transition-colors" disabled><IconPlayerSkipForward className="size-5 fill-current" /></button>
            </div>
            <div className="flex items-center gap-3 w-full group">
              <span className="text-xs text-slate-400 font-medium tabular-nums min-w-[35px] text-right">{formatTime(progress)}</span>
              <input type="range" min="0" max={duration || 100} value={progress} onChange={handleSeek} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400 focus:outline-none focus-visible:ring-2 ring-purple-500/50" />
              <span className="text-xs text-slate-400 font-medium tabular-nums min-w-[35px]">{formatTime(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 w-1/3 min-w-[150px]">
            {volume === 0 ? <IconVolume3 className="size-5 text-slate-400" /> : volume < 0.5 ? <IconVolume2 className="size-5 text-slate-400" /> : <IconVolume className="size-5 text-slate-400" />}
            <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolume} className="w-24 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400 focus:outline-none" />
          </div>
        </div>
        <audio ref={audioRef} onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onEnded={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
      </div>
    </div>
  );
}

export default App;
