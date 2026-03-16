"use client";

import { Loader2, Rss } from "lucide-react";
import { FeedCard } from "./feed-card";
import type { PodcastFeed } from "@/types/feed";

interface FeedListProps {
  feeds: (PodcastFeed & { episode_count?: number })[];
  loading: boolean;
}

export function FeedList({ feeds, loading }: FeedListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (feeds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Rss className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No podcast feeds yet. Import your subscriptions to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {feeds.map((feed) => (
        <FeedCard key={feed.id} feed={feed} />
      ))}
    </div>
  );
}
