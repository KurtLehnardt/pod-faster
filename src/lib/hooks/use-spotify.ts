"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  SpotifySubscription,
  SpotifyConnectionStatus,
  SyncResult,
} from "@/types/spotify";

export interface UseSpotifyReturn {
  // Connection
  status: SpotifyConnectionStatus | null;
  isLoadingStatus: boolean;
  connect: () => Promise<void>;
  disconnect: (removeData?: boolean) => Promise<void>;

  // Subscriptions
  subscriptions: SpotifySubscription[];
  isLoadingSubscriptions: boolean;
  subscriptionError: string | null;

  // Sync
  isSyncing: boolean;
  syncResult: SyncResult | null;
  syncError: string | null;
  sync: () => Promise<void>;

  // Preferences
  toggleSubscription: (id: string, enabled: boolean) => Promise<void>;
  setAllEnabled: (enabled: boolean) => Promise<void>;
}

export function useSpotify(): UseSpotifyReturn {
  const [status, setStatus] = useState<SpotifyConnectionStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [subscriptions, setSubscriptions] = useState<SpotifySubscription[]>([]);
  const [isLoadingSubscriptions, setIsLoadingSubscriptions] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(
    null
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Memoize fetch helpers so they can be used as stable dependencies
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/status");
      if (!res.ok) {
        setStatus({ connected: false });
        return;
      }
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  const fetchSubscriptions = useCallback(async () => {
    setIsLoadingSubscriptions(true);
    setSubscriptionError(null);
    try {
      const res = await fetch("/api/spotify/subscriptions");
      if (!res.ok) {
        throw new Error(`Failed to fetch subscriptions (${res.status})`);
      }
      const data = await res.json();
      setSubscriptions(data.subscriptions ?? []);
    } catch (err) {
      setSubscriptionError(
        err instanceof Error ? err.message : "Failed to fetch subscriptions"
      );
    } finally {
      setIsLoadingSubscriptions(false);
    }
  }, []);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Fetch subscriptions when connected
  useEffect(() => {
    if (status?.connected) fetchSubscriptions();
  }, [status?.connected, fetchSubscriptions]);

  const connect = useCallback(async () => {
    const res = await fetch("/api/spotify/connect", { method: "POST" });
    if (!res.ok) {
      throw new Error(`Failed to initiate Spotify connection (${res.status})`);
    }
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  }, []);

  const disconnect = useCallback(async (removeData = false) => {
    const res = await fetch(
      `/api/spotify/disconnect?remove_data=${removeData}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      throw new Error(`Failed to disconnect Spotify (${res.status})`);
    }
    setStatus({ connected: false });
    setSubscriptions([]);
    setSyncResult(null);
  }, []);

  const sync = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await fetch("/api/spotify/sync", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      setSyncResult(data.result);
      await fetchSubscriptions();
      await fetchStatus();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, [fetchSubscriptions, fetchStatus]);

  const toggleSubscription = useCallback(
    async (id: string, enabled: boolean) => {
      // Optimistic update
      setSubscriptions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, summarization_enabled: enabled } : s
        )
      );
      try {
        await fetch(`/api/spotify/subscriptions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summarization_enabled: enabled }),
        });
      } catch {
        // Revert on failure
        setSubscriptions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, summarization_enabled: !enabled } : s
          )
        );
      }
    },
    []
  );

  const setAllEnabled = useCallback(
    async (enabled: boolean) => {
      const updates = subscriptions.map((s) => ({
        id: s.id,
        summarization_enabled: enabled,
      }));
      setSubscriptions((prev) =>
        prev.map((s) => ({ ...s, summarization_enabled: enabled }))
      );
      try {
        await fetch("/api/spotify/subscriptions/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
      } catch {
        await fetchSubscriptions(); // Revert on failure
      }
    },
    [subscriptions, fetchSubscriptions]
  );

  return {
    status,
    isLoadingStatus,
    connect,
    disconnect,
    subscriptions,
    isLoadingSubscriptions,
    subscriptionError,
    isSyncing,
    syncResult,
    syncError,
    sync,
    toggleSubscription,
    setAllEnabled,
  };
}
