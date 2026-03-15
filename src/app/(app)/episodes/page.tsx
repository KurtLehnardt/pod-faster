"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EpisodeConfig } from "@/components/episodes/episode-config";

export default function EpisodesPage() {
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Episodes</h2>
          <p className="mt-2 text-muted-foreground">
            Your generated podcast episodes will appear here.
          </p>
        </div>
        <Button
          onClick={() => setConfigOpen(true)}
          className="gap-1.5"
        >
          <Plus className="size-4" />
          New Episode
        </Button>
      </div>

      <EpisodeConfig
        open={configOpen}
        onOpenChange={setConfigOpen}
      />
    </div>
  );
}
