"use client";

import { useState, useMemo } from "react";
import { Plus, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedList } from "@/components/feeds/feed-list";
import { ImportDialog } from "@/components/feeds/import-dialog";
import { useFeeds, usePollFeed } from "@/lib/hooks/use-feeds";

type FeedFilter = "all" | "active" | "paused" | "error";

const FILTER_OPTIONS: { value: FeedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "error", label: "Has Errors" },
];

export default function FeedsPage() {
  const { feeds, loading, error, refresh } = useFeeds();
  const { poll, loading: polling } = usePollFeed();
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState<FeedFilter>("all");

  const filteredFeeds = useMemo(() => {
    switch (filter) {
      case "active":
        return feeds.filter((f) => f.is_active && !f.poll_error);
      case "paused":
        return feeds.filter((f) => !f.is_active);
      case "error":
        return feeds.filter((f) => !!f.poll_error);
      default:
        return feeds;
    }
  }, [feeds, filter]);

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
        </div>
      </div>

      {/* Status filter chips */}
      {feeds.length > 0 && (
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
      )}

      <FeedList feeds={filteredFeeds} loading={loading} error={error} />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={refresh}
      />
    </div>
  );
}
