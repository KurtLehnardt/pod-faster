"use client";

import { useState } from "react";
import { Podcast } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EpisodeConfig } from "@/components/episodes/episode-config";

export default function ChatPage() {
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Chat</h2>
          <p className="mt-2 text-muted-foreground">
            Start a conversation to generate your podcast.
          </p>
        </div>
        <Button
          onClick={() => setConfigOpen(true)}
          variant="secondary"
          className="gap-1.5"
        >
          <Podcast className="size-4" />
          Quick Generate
        </Button>
      </div>

      <EpisodeConfig
        open={configOpen}
        onOpenChange={setConfigOpen}
      />
    </div>
  );
}
