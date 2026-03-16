"use client";

import { RefreshCw, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpotifySubscriptionItem } from "./spotify-subscription-item";
import type { SpotifySubscription, SyncResult } from "@/types/spotify";

interface SpotifySubscriptionListProps {
  subscriptions: SpotifySubscription[];
  loading: boolean;
  isSyncing: boolean;
  syncResult: SyncResult | null;
  syncError: string | null;
  onSync: () => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onSelectAll: () => Promise<void>;
  onDeselectAll: () => Promise<void>;
}

export function SpotifySubscriptionList({
  subscriptions,
  loading,
  isSyncing,
  syncResult,
  syncError,
  onSync,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: SpotifySubscriptionListProps) {
  const enabledCount = subscriptions.filter(
    (s) => s.summarization_enabled
  ).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium">Spotify Podcasts</h3>
          <p className="text-xs text-muted-foreground">
            {subscriptions.length} subscriptions, {enabledCount} enabled
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onSync}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 size-3.5" />
          )}
          Sync Now
        </Button>
      </div>

      {/* Controls */}
      {subscriptions.length > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" onClick={onSelectAll}>
            Select All
          </Button>
          <Button variant="ghost" size="xs" onClick={onDeselectAll}>
            Deselect All
          </Button>
        </div>
      )}

      {/* Sync result banner */}
      {syncResult && (
        <div className="flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
          <Check className="size-4 shrink-0" />
          <span>
            Added {syncResult.added}, removed {syncResult.removed}, unchanged{" "}
            {syncResult.unchanged}
          </span>
        </div>
      )}

      {/* Sync error banner */}
      {syncError && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{syncError}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-muted"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && subscriptions.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No podcast subscriptions found. Click &quot;Sync Now&quot; to import
          from Spotify.
        </p>
      )}

      {/* Subscription list */}
      {!loading && subscriptions.length > 0 && (
        <div className="space-y-2">
          {subscriptions.map((sub) => (
            <SpotifySubscriptionItem
              key={sub.id}
              subscription={sub}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
