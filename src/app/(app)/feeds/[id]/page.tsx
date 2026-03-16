"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FeedEpisodeList } from "@/components/feeds/feed-episode-list";
import { useFeed, usePollFeed, useDeleteFeed, useUpdateFeed } from "@/lib/hooks/use-feeds";

export default function FeedDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { feed, episodes, loading, error, refresh } = useFeed(id);
  const { poll, loading: polling } = usePollFeed();
  const { deleteFeed, loading: deleting } = useDeleteFeed();
  const { updateFeed } = useUpdateFeed();
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    try {
      await updateFeed(id, { is_active: checked });
      refresh();
    } catch {
      // handled by hook
    }
  }

  if (loading) {
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
            <p className="text-sm text-muted-foreground line-clamp-2">{feed.description}</p>
          )}
          <p className="text-xs text-muted-foreground">{feed.feed_url}</p>
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
            checked={feed.is_active}
            onCheckedChange={handleToggleActive}
          />
          <Label htmlFor="feed-active">{feed.is_active ? "Active" : "Paused"}</Label>
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
