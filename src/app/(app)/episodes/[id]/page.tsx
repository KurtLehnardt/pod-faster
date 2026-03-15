"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  Pause,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAudioPlayer } from "@/lib/hooks/use-audio-player";
import { ScriptViewer } from "@/components/episodes/script-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EpisodeScript, EpisodeStatus } from "@/types/episode";
import type { Json } from "@/types/database.types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types — row shape from Supabase
// ---------------------------------------------------------------------------

interface EpisodeRow {
  id: string;
  title: string | null;
  topic_query: string;
  status: EpisodeStatus;
  style: string;
  tone: string;
  length_minutes: number;
  audio_duration_seconds: number | null;
  audio_path: string | null;
  script: Json | null;
  sources: Json | null;
  summary: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<EpisodeStatus, string> = {
  pending: "Pending",
  searching: "Searching sources",
  summarizing: "Summarizing",
  scripting: "Writing script",
  generating_audio: "Generating audio",
  uploading: "Uploading",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_VARIANTS: Record<
  EpisodeStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
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
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
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

function parseScript(raw: Json | null): EpisodeScript | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, Json | undefined>;
  if (!Array.isArray(obj.segments)) return null;
  return {
    title: typeof obj.title === "string" ? obj.title : "",
    segments: (obj.segments as Json[]).map((s) => {
      const seg = s as Record<string, Json | undefined>;
      return {
        speaker: String(seg.speaker ?? ""),
        text: String(seg.text ?? ""),
        voice_id: String(seg.voice_id ?? ""),
      };
    }),
  };
}

interface SourceItem {
  title?: string;
  url?: string;
}

function parseSources(raw: Json | null): SourceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, Json | undefined> => typeof s === "object" && s !== null)
    .map((s) => ({
      title: typeof s.title === "string" ? s.title : undefined,
      url: typeof s.url === "string" ? s.url : undefined,
    }))
    .filter((s) => s.url);
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function EpisodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [episode, setEpisode] = useState<EpisodeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const { play, pause: pauseAudio, currentEpisode, isPlaying } = useAudioPlayer();

  const isCurrentlyPlaying = currentEpisode?.id === id && isPlaying;
  const isComplete = episode?.status === "completed";

  // Fetch episode
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("episodes")
        .select("*")
        .eq("id", id)
        .single();

      if (!cancelled) {
        if (!error && data) {
          setEpisode(data as unknown as EpisodeRow);
        }
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Play handler
  const handlePlay = useCallback(async () => {
    if (!episode || !isComplete) return;

    if (isCurrentlyPlaying) {
      pauseAudio();
      return;
    }

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
      /* silent */
    }
  }, [episode, isComplete, isCurrentlyPlaying, pauseAudio, play]);

  // Delete handler
  const handleDelete = useCallback(async () => {
    if (!episode) return;
    if (!confirm("Delete this episode? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/episodes/${episode.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/episodes");
      }
    } catch {
      /* silent */
    } finally {
      setDeleting(false);
    }
  }, [episode, router]);

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not found
  if (!episode) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-10 text-center">
        <p className="text-muted-foreground">Episode not found.</p>
        <Link href="/episodes">
          <Button variant="outline">
            <ArrowLeft className="size-4" data-icon="inline-start" />
            Back to Episodes
          </Button>
        </Link>
      </div>
    );
  }

  const script = parseScript(episode.script);
  const sources = parseSources(episode.sources);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Back link */}
      <Link
        href="/episodes"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Episodes
      </Link>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            {episode.title || episode.topic_query}
          </h1>
          <Badge
            variant={STATUS_VARIANTS[episode.status]}
            className="shrink-0"
          >
            {isInProgress(episode.status) && (
              <Loader2 className="mr-1 size-3 animate-spin" />
            )}
            {STATUS_LABELS[episode.status]}
          </Badge>
        </div>

        {episode.title && (
          <p className="text-sm text-muted-foreground">{episode.topic_query}</p>
        )}

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="size-3.5" />
            {formatDate(episode.created_at)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {formatDuration(
              episode.audio_duration_seconds,
              episode.length_minutes
            )}
          </span>
          <Badge variant="outline" className="text-xs">
            {episode.style.replace("_", " ")}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {episode.tone.replace("_", " ")}
          </Badge>
        </div>

        {/* Error message */}
        {episode.status === "failed" && episode.error_message && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {episode.error_message}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {isComplete && (
            <Button onClick={handlePlay}>
              {isCurrentlyPlaying ? (
                <Pause className="size-4" data-icon="inline-start" />
              ) : (
                <Play className="size-4" data-icon="inline-start" />
              )}
              {isCurrentlyPlaying ? "Pause" : "Play Episode"}
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
            ) : (
              <Trash2 className="size-4" data-icon="inline-start" />
            )}
            Delete
          </Button>
        </div>
      </div>

      {/* Summary */}
      {episode.summary && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Summary</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {episode.summary}
          </p>
        </section>
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Sources</h2>
          <ul className="space-y-1">
            {sources.map((src, i) => (
              <li key={i}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="size-3" />
                  {src.title || src.url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Script */}
      {script && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Script</h2>
          <ScriptViewer
            script={script}
            episodeId={episode.id}
            className="max-h-[600px] overflow-y-auto pr-1"
          />
        </section>
      )}

      {/* Generation in progress */}
      {isInProgress(episode.status) && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <Loader2 className="size-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">
              Generation in progress
            </p>
            <p className="text-xs text-muted-foreground">
              Current step: {STATUS_LABELS[episode.status].toLowerCase()}.
              Refresh the page to check for updates.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
