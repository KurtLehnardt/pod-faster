"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, RefreshCw, Loader2, Podcast, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FeedList } from "@/components/feeds/feed-list";
import { ImportDialog } from "@/components/feeds/import-dialog";
import { EpisodeConfig } from "@/components/episodes/episode-config";
import { useFeeds, usePollFeed } from "@/lib/hooks/use-feeds";

type FeedFilter = "all" | "active" | "paused" | "error";

const FILTER_OPTIONS: { value: FeedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "error", label: "Has Errors" },
];

export default function FeedsPage() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("search") ?? "";
  const { feeds, loading, error, refresh } = useFeeds();
  const { poll, loading: polling } = usePollFeed();
  const [importOpen, setImportOpen] = useState(false);
  const [episodeDialogOpen, setEpisodeDialogOpen] = useState(false);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [searchQuery, setSearchQuery] = useState(initialSearch);

  const filteredFeeds = useMemo(() => {
    let result = feeds;

    // Apply status filter
    switch (filter) {
      case "active":
        result = result.filter((f) => f.is_active && !f.poll_error);
        break;
      case "paused":
        result = result.filter((f) => !f.is_active);
        break;
      case "error":
        result = result.filter((f) => !!f.poll_error);
        break;
    }

    // Apply text search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          (f.title?.toLowerCase().includes(q) ?? false) ||
          (f.description?.toLowerCase().includes(q) ?? false) ||
          f.feed_url.toLowerCase().includes(q)
      );
    }

    return result;
  }, [feeds, filter, searchQuery]);

  async function handlePollAll() {
    try {
      await poll();
      refresh();
    } catch {
      // error handled by hook
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Podcast Feeds</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePollAll} disabled={polling}>
            {polling ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Poll All
          </Button>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Plus className="mr-2 size-4" />
            Import Feeds
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEpisodeDialogOpen(true)}
          >
            <Podcast className="mr-2 size-4" />
            New Episode
          </Button>
        </div>
      </div>

      {/* Search and filter controls */}
      {feeds.length > 0 && (
        <div className="space-y-3">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search feeds by name, description, or URL..."
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-2">
            {FILTER_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  filter === value
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <FeedList feeds={filteredFeeds} loading={loading} error={error} />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={refresh}
      />

      <EpisodeConfig
        open={episodeDialogOpen}
        onOpenChange={setEpisodeDialogOpen}
      />
    </div>
  );
}
