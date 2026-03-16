"use client";

import Link from "next/link";
import { AlertCircle, Clock, Rss } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PodcastFeed } from "@/types/feed";

interface FeedCardProps {
  feed: PodcastFeed & { episode_count?: number };
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function FeedCard({ feed }: FeedCardProps) {
  return (
    <Link
      href={`/feeds/${feed.id}`}
      className={cn(
        "group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent",
        !feed.is_active && "opacity-60"
      )}
    >
      {/* Icon / Image */}
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
        {feed.image_url ? (
          <img
            src={feed.image_url}
            alt=""
            className="size-10 rounded-md object-cover"
          />
        ) : (
          <Rss className="size-5 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 space-y-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{feed.title || feed.feed_url}</p>
          {!feed.is_active && (
            <Badge variant="secondary" className="text-xs">Paused</Badge>
          )}
          {feed.poll_error && (
            <AlertCircle className="size-3.5 shrink-0 text-destructive" />
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {feed.episode_count !== undefined && (
            <span>{feed.episode_count} episodes</span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            Polled {formatRelative(feed.last_polled_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}
