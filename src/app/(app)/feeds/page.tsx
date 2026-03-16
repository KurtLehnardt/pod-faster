"use client";

import { Suspense, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, RefreshCw, Loader2, Podcast, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FeedList } from "@/components/feeds/feed-list";
import { ImportDialog } from "@/components/feeds/import-dialog";
import { EpisodeConfig } from "@/components/episodes/episode-config";
import { useFeeds, usePollFeed } from "@/lib/hooks/use-feeds";

type StatusFilter = "all" | "active" | "paused" | "error";
type SourceFilter = "all" | "spotify" | "imported";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "error", label: "Has Errors" },
];

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All Sources" },
  { value: "spotify", label: "Spotify" },
  { value: "imported", label: "Imported" },
];

/**
 * Check if ALL search words appear somewhere in the feed metadata.
 * Uses word-boundary (AND) logic instead of simple substring matching.
 */
function matchesSearch(
  query: string,
  title?: string | null,
  description?: string | null,
  feedUrl?: string
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const haystack = [
    title ?? "",
    description ?? "",
    feedUrl ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return words.every((word) => haystack.includes(word));
}

function FeedsPageContent() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("search") ?? "";
  const { feeds, loading, error, refresh } = useFeeds();
  const { poll, loading: polling } = usePollFeed();
  const [importOpen, setImportOpen] = useState(false);
  const [episodeDialogOpen, setEpisodeDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [searchQuery, setSearchQuery] = useState(initialSearch);

  const filteredFeeds = useMemo(() => {
    let result = feeds;

    // Apply status filter
    switch (statusFilter) {
      case "active":
        result = result.filter((f) => f.is_active);
        break;
      case "paused":
        result = result.filter((f) => !f.is_active);
        break;
      case "error":
        result = result.filter((f) => !!f.poll_error);
        break;
    }

    // Apply source filter
    if (sourceFilter !== "all") {
      result = result.filter((f) => f.source === sourceFilter);
    }

    // Apply text search filter (AND logic: all words must appear)
    if (searchQuery.trim()) {
      result = result.filter((f) =>
        matchesSearch(searchQuery, f.title, f.description, f.feed_url)
      );
    }

    return result;
  }, [feeds, statusFilter, sourceFilter, searchQuery]);

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

          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_OPTIONS.map(({ value, label }) => (
              <button
                key={`status-${value}`}
                onClick={() => setStatusFilter(value)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  statusFilter === value
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="mx-1 text-border">|</span>
            {SOURCE_OPTIONS.map(({ value, label }) => (
              <button
                key={`source-${value}`}
                onClick={() => setSourceFilter(value)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  sourceFilter === value
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

export default function FeedsPage() {
  return (
    <Suspense fallback={null}>
      <FeedsPageContent />
    </Suspense>
  );
}
