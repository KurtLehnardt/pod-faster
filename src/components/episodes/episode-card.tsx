"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Clock,
  Loader2,
  Play,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAudioPlayer } from "@/lib/hooks/use-audio-player";
import type { EpisodeStatus, EpisodeStyle, EpisodeTone } from "@/types/episode";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpisodeCardData {
  id: string;
  title: string | null;
  topic_query: string;
  status: EpisodeStatus;
  style: EpisodeStyle;
  tone: EpisodeTone;
  length_minutes: number;
  audio_duration_seconds: number | null;
  created_at: string;
}

interface EpisodeCardProps {
  episode: EpisodeCardData;
  onDelete?: (id: string) => void;
  isDeleting?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<EpisodeStatus, string> = {
  pending: "Pending",
  searching: "Searching",
  summarizing: "Summarizing",
  scripting: "Writing Script",
  generating_audio: "Generating Audio",
  uploading: "Uploading",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_VARIANTS: Record<EpisodeStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  searching: "secondary",
  summarizing: "secondary",
  scripting: "secondary",
  generating_audio: "secondary",
  uploading: "secondary",
  completed: "default",
  failed: "destructive",
};

function isInProgress(status: EpisodeStatus): boolean {
  return !["completed", "failed", "pending"].includes(status);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(seconds: number | null, minutes: number): string {
  if (seconds && seconds > 0) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  return `~${minutes} min`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EpisodeCard({ episode, onDelete, isDeleting }: EpisodeCardProps) {
  const router = useRouter();
  const { play, currentEpisode, isPlaying } = useAudioPlayer();
  const isCurrentlyPlaying = currentEpisode?.id === episode.id && isPlaying;
  const isComplete = episode.status === "completed";

  async function handlePlay(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isComplete) return;

    try {
      const res = await fetch(`/api/episodes/${episode.id}/audio`);
      if (!res.ok) return;
      const data = await res.json();
      play({
        id: episode.id,
        title: episode.title || episode.topic_query,
        audioUrl: data.url,
      });
    } catch {
      /* silent fail */
    }
  }

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onDelete?.(episode.id);
  }

  return (
    <Link
      href={`/episodes/${episode.id}`}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-md",
        isCurrentlyPlaying && "border-primary/50 ring-1 ring-primary/20"
      )}
    >
      {/* Header: title + status */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {episode.title || episode.topic_query}
        </h3>
        <Badge variant={STATUS_VARIANTS[episode.status]} className="shrink-0">
          {isInProgress(episode.status) && (
            <Loader2 className="mr-1 size-3 animate-spin" />
          )}
          {STATUS_LABELS[episode.status]}
        </Badge>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-[10px]">
          {episode.style.replace("_", " ")}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {episode.tone.replace("_", " ")}
        </Badge>
      </div>

      {/* Footer: date, duration, actions */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Calendar className="size-3" />
          {formatDate(episode.created_at)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" />
          {formatDuration(episode.audio_duration_seconds, episode.length_minutes)}
        </span>
        <span className="flex-1" />

        {/* Play button */}
        {isComplete && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handlePlay}
            aria-label={isCurrentlyPlaying ? "Playing" : "Play episode"}
          >
            {isCurrentlyPlaying ? (
              <span className="flex items-center gap-0.5">
                <span className="block h-2.5 w-0.5 animate-pulse rounded-full bg-primary" />
                <span className="block h-3.5 w-0.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                <span className="block h-2 w-0.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
              </span>
            ) : (
              <Play className="size-3.5" />
            )}
          </Button>
        )}

        {/* Delete button */}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleDelete}
          disabled={isDeleting}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Delete episode"
        >
          {isDeleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      </div>
    </Link>
  );
}
