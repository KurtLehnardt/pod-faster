"use client";

import { useState } from "react";
import { Plus, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedList } from "@/components/feeds/feed-list";
import { ImportDialog } from "@/components/feeds/import-dialog";
import { useFeeds, usePollFeed } from "@/lib/hooks/use-feeds";

export default function FeedsPage() {
  const { feeds, loading, error, refresh } = useFeeds();
  const { poll, loading: polling } = usePollFeed();
  const [importOpen, setImportOpen] = useState(false);

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

      <FeedList feeds={feeds} loading={loading} error={error} />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={refresh}
      />
    </div>
  );
}
