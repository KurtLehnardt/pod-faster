"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FeedEpisodeList } from "@/components/feeds/feed-episode-list";
import { useFeed, usePollFeed, useDeleteFeed, useUpdateFeed } from "@/lib/hooks/use-feeds";
import { stripHtml } from "@/lib/utils/strip-html";

export default function FeedDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { feed, episodes, initialLoading, error, refresh } = useFeed(id);
  const { poll, loading: polling } = usePollFeed();
  const { deleteFeed, loading: deleting } = useDeleteFeed();
  const { updateFeed } = useUpdateFeed();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Optimistic override for active toggle to avoid full-page re-render
  const [activeOverride, setActiveOverride] = useState<boolean | null>(null);
  // Optimistic override for auto-transcribe toggle
  const [autoTranscribeOverride, setAutoTranscribeOverride] = useState<boolean | null>(null);

  // Clear optimistic overrides once server data catches up
  useEffect(() => {
    if (feed && activeOverride !== null && feed.is_active === activeOverride) {
      setActiveOverride(null);
    }
  }, [feed, activeOverride]);

  useEffect(() => {
    if (feed && autoTranscribeOverride !== null && feed.auto_transcribe === autoTranscribeOverride) {
      setAutoTranscribeOverride(null);
    }
  }, [feed, autoTranscribeOverride]);

  async function handlePoll() {
    try {
      await poll(id);
      refresh();
    } catch {
      // handled by hook
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteFeed(id);
      router.push("/feeds");
    } catch {
      // handled by hook
    }
  }

  async function handleToggleActive(checked: boolean) {
    // Optimistic update: immediately show the new state
    setActiveOverride(checked);
    try {
      await updateFeed(id, { is_active: checked });
      // Sync the underlying data without visible blink
      refresh();
    } catch {
      // Revert optimistic update on failure
      setActiveOverride(null);
    }
  }

  async function handleToggleAutoTranscribe(checked: boolean) {
    setAutoTranscribeOverride(checked);
    try {
      await updateFeed(id, { auto_transcribe: checked });
      refresh();
    } catch (err) {
      setAutoTranscribeOverride(null);
      if (err instanceof Error && err.message.includes("premium")) {
        alert("Auto-transcribe requires a premium subscription.");
      }
    }
  }

  // Use optimistic value if set, otherwise use server value
  const isActive = activeOverride ?? feed?.is_active ?? false;
  const isAutoTranscribe = autoTranscribeOverride ?? feed?.auto_transcribe ?? false;

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !feed) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Link href="/feeds" className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to feeds
        </Link>
        <p className="text-destructive">{error || "Feed not found"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Back link */}
      <Link href="/feeds" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to feeds
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4">
        {feed.image_url && (
          <img src={feed.image_url} alt="" className="size-16 rounded-lg object-cover" />
        )}
        <div className="flex-1 space-y-1">
          <h1 className="text-xl font-bold">{feed.title || feed.feed_url}</h1>
          {feed.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{stripHtml(feed.description)}</p>
          )}
          <a
            href={feed.feed_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            {feed.feed_url}
          </a>
        </div>
      </div>

      {/* Error banner */}
      {feed.poll_error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>Poll error: {feed.poll_error} ({feed.poll_error_count} consecutive failures)</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id="feed-active"
            checked={isActive}
            onCheckedChange={handleToggleActive}
          />
          <Label htmlFor="feed-active">{isActive ? "Active" : "Paused"}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="feed-auto-transcribe"
            checked={isAutoTranscribe}
            onCheckedChange={handleToggleAutoTranscribe}
          />
          <Label htmlFor="feed-auto-transcribe" className="flex items-center gap-1">
            Auto-transcribe
            <Sparkles className="size-3 text-amber-500" />
          </Label>
        </div>
        <Badge variant="secondary">{episodes.length} episodes</Badge>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handlePoll} disabled={polling}>
          {polling ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
          Poll Now
        </Button>
        <Button
          variant={confirmDelete ? "destructive" : "outline"}
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}
          {confirmDelete ? "Confirm Delete" : "Delete"}
        </Button>
      </div>

      {/* Episodes */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Episodes</h2>
        <FeedEpisodeList episodes={episodes} onRefresh={refresh} />
      </div>
    </div>
  );
}
