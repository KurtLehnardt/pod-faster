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
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
  }, []);

  // Fetch subscriptions when connected
  useEffect(() => {
    if (status?.connected) fetchSubscriptions();
  }, [status?.connected]);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/spotify/status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setIsLoadingStatus(false);
    }
  }

  async function fetchSubscriptions() {
    setIsLoadingSubscriptions(true);
    try {
      const res = await fetch("/api/spotify/subscriptions");
      const data = await res.json();
      setSubscriptions(data.subscriptions ?? []);
    } catch {
      // silently fail
    } finally {
      setIsLoadingSubscriptions(false);
    }
  }

  const connect = useCallback(async () => {
    const res = await fetch("/api/spotify/connect", { method: "POST" });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  }, []);

  const disconnect = useCallback(async (removeData = false) => {
    await fetch(`/api/spotify/disconnect?remove_data=${removeData}`, {
      method: "DELETE",
    });
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
  }, []);

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
    [subscriptions]
  );

  return {
    status,
    isLoadingStatus,
    connect,
    disconnect,
    subscriptions,
    isLoadingSubscriptions,
    isSyncing,
    syncResult,
    syncError,
    sync,
    toggleSubscription,
    setAllEnabled,
  };
}
