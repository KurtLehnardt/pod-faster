"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import type { FeedEpisode, TranscriptionStatus } from "@/types/feed";

interface FeedEpisodeListProps {
  episodes: FeedEpisode[];
  onRefresh?: () => void;
}

const statusLabel: Record<TranscriptionStatus, string> = {
  none: "No transcript",
  pending: "Pending",
  processing: "Transcribing...",
  completed: "Transcribed",
  failed: "Failed",
};

const statusVariant: Record<TranscriptionStatus, "default" | "secondary" | "destructive" | "outline"> = {
  none: "outline",
  pending: "secondary",
  processing: "secondary",
  completed: "default",
  failed: "destructive",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Unknown date";
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function FeedEpisodeList({ episodes, onRefresh }: FeedEpisodeListProps) {
  const [transcribingId, setTranscribingId] = useState<string | null>(null);

  async function handleTranscribe(episodeId: string) {
    setTranscribingId(episodeId);
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedEpisodeId: episodeId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Transcription failed");
      }
      onRefresh?.();
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setTranscribingId(null);
    }
  }

  if (episodes.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No episodes found.
      </p>
    );
  }

  return (
    <div className="divide-y">
      {episodes.map((ep) => (
        <div key={ep.id} className="flex items-center gap-3 py-3">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 space-y-0.5 overflow-hidden">
            <p className="truncate text-sm font-medium">{ep.title}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatDate(ep.published_at)}</span>
              {ep.duration_seconds && <span>{formatDuration(ep.duration_seconds)}</span>}
            </div>
          </div>
          <Badge variant={statusVariant[ep.transcription_status]}>
            {statusLabel[ep.transcription_status]}
          </Badge>
          {(ep.transcription_status === "none" || ep.transcription_status === "failed") && ep.audio_url && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleTranscribe(ep.id)}
              disabled={transcribingId === ep.id}
            >
              {transcribingId === ep.id && <Loader2 className="mr-1 size-3 animate-spin" />}
              Transcribe
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
