"use client";

import Link from "next/link";
import { AlertCircle, Clock, Rss } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PodcastFeed } from "@/types/feed";

function SpotifyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
}

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
          {feed.source === "spotify" ? (
            <SpotifyIcon className="size-3.5 shrink-0 text-[#1DB954]" />
          ) : (
            <Rss className="size-3.5 shrink-0 text-muted-foreground" />
          )}
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
