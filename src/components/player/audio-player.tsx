"use client";

import { useCallback, useRef, type MouseEvent } from "react";
import {
  Pause,
  Play,
  Volume2,
  Volume1,
  VolumeX,
  Loader2,
} from "lucide-react";
import { useAudioPlayer } from "@/lib/hooks/use-audio-player";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Speed options
// ---------------------------------------------------------------------------

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function VolumeIcon({ volume }: { volume: number }) {
  if (volume === 0) return <VolumeX className="size-4" />;
  if (volume < 0.5) return <Volume1 className="size-4" />;
  return <Volume2 className="size-4" />;
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

function ProgressBar({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      if (!bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(fraction * duration);
    },
    [duration, onSeek]
  );

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Playback progress"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      tabIndex={0}
      className="group relative h-1.5 w-full cursor-pointer rounded-full bg-muted transition-all hover:h-2.5"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(currentTime + 5, duration));
        if (e.key === "ArrowLeft") onSeek(Math.max(currentTime - 5, 0));
      }}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width]"
        style={{ width: `${pct}%` }}
      />
      {/* Thumb */}
      <div
        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VolumeSlider
// ---------------------------------------------------------------------------

function VolumeSlider({
  volume,
  onVolumeChange,
}: {
  volume: number;
  onVolumeChange: (v: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onVolumeChange(fraction);
    },
    [onVolumeChange]
  );

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(volume * 100)}
      tabIndex={0}
      className="h-1.5 w-20 cursor-pointer rounded-full bg-muted"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onVolumeChange(Math.min(volume + 0.1, 1));
        if (e.key === "ArrowLeft") onVolumeChange(Math.max(volume - 0.1, 0));
      }}
    >
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${volume * 100}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AudioPlayer
// ---------------------------------------------------------------------------

interface AudioPlayerProps {
  /** Compact mode for the bottom bar */
  compact?: boolean;
  className?: string;
}

export function AudioPlayer({ compact = false, className }: AudioPlayerProps) {
  const {
    currentEpisode,
    isPlaying,
    currentTime,
    duration,
    volume,
    speed,
    isLoading,
    togglePlayPause,
    seek,
    setVolume,
    setSpeed,
  } = useAudioPlayer();

  const prevVolume = useRef(volume);

  const handleMuteToggle = useCallback(() => {
    if (volume > 0) {
      prevVolume.current = volume;
      setVolume(0);
    } else {
      setVolume(prevVolume.current || 0.5);
    }
  }, [volume, setVolume]);

  const cycleSpeed = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(speed as (typeof SPEED_OPTIONS)[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setSpeed(next);
  }, [speed, setSpeed]);

  if (!currentEpisode) return null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Progress bar (full width on top in compact mode) */}
      {compact && (
        <ProgressBar currentTime={currentTime} duration={duration} onSeek={seek} />
      )}

      <div
        className={cn(
          "flex items-center gap-3",
          compact ? "px-4" : "gap-4"
        )}
      >
        {/* Play/Pause */}
        <button
          onClick={togglePlayPause}
          disabled={isLoading}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4 translate-x-px" />
          )}
        </button>

        {/* Episode title */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {currentEpisode.title}
          </p>
          {!compact && (
            <p className="text-xs text-muted-foreground">
              {formatTime(currentTime)} / {formatTime(duration)}
            </p>
          )}
        </div>

        {/* Time display (compact) */}
        {compact && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        )}

        {/* Speed */}
        <button
          onClick={cycleSpeed}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Playback speed: ${speed}x`}
        >
          {speed}x
        </button>

        {/* Volume (hidden on mobile in compact mode) */}
        <div className={cn("hidden shrink-0 items-center gap-1.5", compact ? "md:flex" : "flex")}>
          <button
            onClick={handleMuteToggle}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={volume === 0 ? "Unmute" : "Mute"}
          >
            <VolumeIcon volume={volume} />
          </button>
          <VolumeSlider volume={volume} onVolumeChange={setVolume} />
        </div>
      </div>

      {/* Full progress bar when not compact */}
      {!compact && (
        <ProgressBar currentTime={currentTime} duration={duration} onSeek={seek} />
      )}
    </div>
  );
}
