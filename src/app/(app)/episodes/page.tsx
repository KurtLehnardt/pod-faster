"use client";

import { useCallback, useEffect, useState } from "react";
import { Headphones, Loader2, MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { EpisodeCard, type EpisodeCardData } from "@/components/episodes/episode-card";
import { EpisodeConfig } from "@/components/episodes/episode-config";
import { Button } from "@/components/ui/button";
import type { EpisodeStatus } from "@/types/episode";

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

type FilterValue = "all" | "completed" | "in_progress" | "failed";

const FILTERS: { label: string; value: FilterValue }[] = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completed" },
  { label: "In Progress", value: "in_progress" },
  { label: "Failed", value: "failed" },
];

const IN_PROGRESS_STATUSES: EpisodeStatus[] = [
  "pending",
  "searching",
  "summarizing",
  "scripting",
  "generating_audio",
  "uploading",
];

function matchesFilter(status: EpisodeStatus, filter: FilterValue): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return status === "completed";
  if (filter === "failed") return status === "failed";
  return IN_PROGRESS_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EpisodesPage() {
  const [episodes, setEpisodes] = useState<EpisodeCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("episodes")
        .select(
          "id, title, topic_query, status, style, tone, length_minutes, audio_duration_seconds, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(100);

      if (!cancelled) {
        if (!error && data) {
          setEpisodes(data as EpisodeCardData[]);
        }
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this episode? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/episodes/${id}`, { method: "DELETE" });
      if (res.ok) {
        setEpisodes((prev) => prev.filter((ep) => ep.id !== id));
      }
    } catch {
      /* silent */
    } finally {
      setDeletingId(null);
    }
  }, []);

  const filtered = episodes.filter((ep) => matchesFilter(ep.status, filter));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Episodes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your generated podcast episodes
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setConfigOpen(true)} className="gap-1.5">
            <Plus className="size-4" />
            New Episode
          </Button>
          <Link href="/chat">
            <Button variant="outline">
              <MessageSquare className="size-4" data-icon="inline-start" />
              Chat
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filter={filter} totalCount={episodes.length} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((ep) => (
            <EpisodeCard
              key={ep.id}
              episode={ep}
              onDelete={handleDelete}
              isDeleting={deletingId === ep.id}
            />
          ))}
        </div>
      )}

      <EpisodeConfig open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState({
  filter,
  totalCount,
}: {
  filter: FilterValue;
  totalCount: number;
}) {
  if (totalCount > 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
        <p className="text-sm text-muted-foreground">
          No {filter === "in_progress" ? "in-progress" : filter} episodes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
        <Headphones className="size-7 text-primary" />
      </div>
      <div className="text-center">
        <p className="font-medium text-foreground">No episodes yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a conversation to create your first podcast episode.
        </p>
      </div>
      <Link href="/chat">
        <Button variant="default">
          <MessageSquare className="size-4" data-icon="inline-start" />
          Start Chatting
        </Button>
      </Link>
    </div>
  );
}
