import { useEffect, useRef, useState } from "react";
import {
  IconMusic,
  IconPlayerPause,
  IconPlayerPlay,
  IconVolume,
  IconVolume2,
  IconVolume3,
  IconX,
} from "@tabler/icons-react";
import type { DownloadJob } from "./models";
import { jobArtist, jobTitle } from "./JobWorkspace";

interface PlayerBarProps {
  job: DownloadJob | null;
  onClose: () => void;
}

export function PlayerBar({ job, onClose }: PlayerBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !job) return;
    audio.src = `/api/stream?track=${job.trackId}`;
    audio.currentTime = 0;
    setCurrentTime(0);
    void audio.play().catch(() => setPlaying(false));
  }, [job?.id]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  return (
    <>
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
      />
      {job ? (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#0b0d10]/96 px-3 py-2.5 shadow-[0_-12px_40px_rgba(0,0,0,.35)] backdrop-blur-xl lg:left-60 xl:left-64">
          <div className="mx-auto flex max-w-6xl items-center gap-3 sm:gap-5">
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-[280px]">
              <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.06] text-white/25">
                {job.metadata?.coverUrl || job.coverUrl ? (
                  <img src={job.metadata?.coverUrl || job.coverUrl} alt="" className="size-full object-cover" />
                ) : <IconMusic className="size-4" />}
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-white/90">{jobTitle(job)}</div>
                <div className="mt-0.5 truncate text-[10px] text-white/35">{jobArtist(job)}</div>
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
                max={duration || 1}
                step="0.1"
                value={Math.min(currentTime, duration || 1)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (audioRef.current) audioRef.current.currentTime = value;
                  setCurrentTime(value);
                }}
                className="soggfy-range min-w-20 flex-1"
              />
              <span className="w-9 text-[10px] tabular-nums text-white/35">{formatTime(duration)}</span>
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
      ) : null}
    </>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
