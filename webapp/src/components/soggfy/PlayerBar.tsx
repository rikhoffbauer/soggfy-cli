import { useEffect, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconMusic,
  IconPlayerPause,
  IconPlayerPlay,
  IconVolume,
  IconVolume2,
  IconVolume3,
  IconX,
} from "@tabler/icons-react";
import type { DownloadJob, DownloadState } from "./models";
import { playerStatus, seekLimit } from "./player-model";
import { jobArtist, jobTitle } from "./JobWorkspace";

interface PlayerBarProps {
  job: DownloadJob | null;
  onClose: () => void;
}

function streamUrl(job: DownloadJob) {
  return `/api/stream?track=${encodeURIComponent(job.trackId)}&job=${job.id}`;
}

export function PlayerBar({ job, onClose }: PlayerBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const previousState = useRef<DownloadState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);

  const updateBufferedEnd = () => {
    const audio = audioRef.current;
    if (!audio || audio.buffered.length === 0) return setBufferedEnd(0);
    setBufferedEnd(audio.buffered.end(audio.buffered.length - 1));
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !job) return;
    previousState.current = job.state;
    setPlaybackError(null);
    setBuffering(job.state !== "completed");
    setCurrentTime(0);
    setBufferedEnd(0);
    setDuration(job.durationMs ? job.durationMs / 1000 : 0);
    audio.src = streamUrl(job);
    audio.currentTime = 0;
    audio.load();
    void audio.play().catch(() => setPlaying(false));
  }, [job?.id]);

  useEffect(() => {
    if (!job) {
      previousState.current = null;
      return;
    }
    const oldState = previousState.current;
    previousState.current = job.state;
    if (!oldState || oldState === "completed" || job.state !== "completed") return;
    const audio = audioRef.current;
    if (!audio) return;
    const resumeAt = audio.currentTime;
    const resumePlaying = !audio.paused;
    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(resumeAt, audio.duration);
      if (resumePlaying) void audio.play().catch(() => setPlaying(false));
    };
    audio.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
    audio.src = streamUrl(job);
    audio.load();
    return () => audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
  }, [job?.state, job?.id]);

  if (!job) return <audio ref={audioRef} />;

  const status = playbackError || playerStatus(job, playing, buffering);
  const seekMax = seekLimit(job, duration, bufferedEnd);
  const seekDisabled = seekMax <= 0;

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };

  return (
    <>
      <audio
        ref={audioRef}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => { setPlaying(true); setBuffering(false); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => { setPlaybackError("Playback stream unavailable"); setBuffering(false); setPlaying(false); }}
        onProgress={updateBufferedEnd}
        onTimeUpdate={(event) => { setCurrentTime(event.currentTarget.currentTime); updateBufferedEnd(); }}
        onLoadedMetadata={(event) => {
          const mediaDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(mediaDuration) ? mediaDuration : (job.durationMs ? job.durationMs / 1000 : 0));
          updateBufferedEnd();
        }}
        onDurationChange={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration);
        }}
      />
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#0b0d10]/96 px-3 py-2.5 shadow-[0_-12px_40px_rgba(0,0,0,.35)] backdrop-blur-xl lg:left-60 xl:left-64">
        <div className="mx-auto flex max-w-6xl items-center gap-3 sm:gap-5">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-[300px]">
            <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.06] text-white/25">
              {job.metadata?.coverUrl || job.coverUrl ? (
                <img src={job.metadata?.coverUrl || job.coverUrl} alt="" className="size-full object-cover" />
              ) : <IconMusic className="size-4" />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-white/90">{jobTitle(job)}</div>
              <div className="mt-0.5 truncate text-[10px] text-white/35">{jobArtist(job)}</div>
              <div className={`mt-0.5 flex items-center gap-1 truncate text-[10px] ${playbackError ? "text-red-300" : "text-primary/70"}`}>
                {playbackError ? <IconAlertCircle className="size-3 shrink-0" /> : null}{status}
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={togglePlayback}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-black transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {playing ? <IconPlayerPause className="size-4 fill-current" /> : <IconPlayerPlay className="ml-0.5 size-4 fill-current" />}
          </button>

          <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
            <span className="w-9 text-right text-[10px] tabular-nums text-white/35">{formatTime(currentTime)}</span>
            <input
              aria-label="Playback position"
              type="range"
              min="0"
              max={seekMax || 1}
              step="0.1"
              disabled={seekDisabled}
              value={Math.min(currentTime, seekMax || 0)}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (audioRef.current) audioRef.current.currentTime = value;
                setCurrentTime(value);
              }}
              className="soggfy-range min-w-20 flex-1 disabled:opacity-35"
            />
            <span className="w-9 text-[10px] tabular-nums text-white/35">{formatTime(job.state === "completed" ? duration : seekMax)}</span>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            {volume === 0 ? <IconVolume3 className="size-4 text-white/35" /> : volume < 0.5 ? <IconVolume2 className="size-4 text-white/35" /> : <IconVolume className="size-4 text-white/35" />}
            <input
              aria-label="Volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(event) => {
                const value = Number(event.target.value);
                setVolume(value);
                if (audioRef.current) audioRef.current.volume = value;
              }}
              className="soggfy-range w-20"
            />
          </div>

          <button type="button" aria-label="Close player" title="Close player" onClick={onClose} className="rounded-md p-1.5 text-white/25 hover:bg-white/8 hover:text-white">
            <IconX className="size-4" />
          </button>
        </div>
      </div>
    </>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
