"use client";

import { ExternalLink, Podcast } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { SpotifySubscription } from "@/types/spotify";

interface SpotifySubscriptionItemProps {
  subscription: SpotifySubscription;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
}

export function SpotifySubscriptionItem({
  subscription,
  onToggle,
}: SpotifySubscriptionItemProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-3 min-w-0">
        {subscription.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={subscription.image_url}
            alt={subscription.show_name}
            className="size-10 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
            <Podcast className="size-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {subscription.show_name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {subscription.publisher}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {subscription.total_episodes} ep
        </span>
        <Switch
          checked={subscription.summarization_enabled}
          onCheckedChange={(checked: boolean) =>
            onToggle(subscription.id, checked)
          }
          size="sm"
        />
        <a
          href={subscription.spotify_url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          aria-label={`Open ${subscription.show_name} on Spotify`}
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
