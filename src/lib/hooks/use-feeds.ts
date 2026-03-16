"use client";

import { useState, useEffect, useCallback } from "react";
import type { PodcastFeed, FeedEpisode } from "@/types/feed";
import type { UpdateFeedInput } from "@/lib/validation/feed-schemas";

// ── useFeeds ────────────────────────────────────────────────

export interface UseFeedsReturn {
  feeds: PodcastFeed[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useFeeds(): UseFeedsReturn {
  const [feeds, setFeeds] = useState<PodcastFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch("/api/feeds")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch feeds (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setFeeds(data.feeds ?? []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to fetch feeds");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [tick]);

  return { feeds, loading, error, refresh };
}

// ── useFeed ─────────────────────────────────────────────────

export interface UseFeedReturn {
  feed: PodcastFeed | null;
  episodes: FeedEpisode[];
  loading: boolean;
  /** True only during the first fetch. Use this for full-page spinner gates. */
  initialLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useFeed(id: string): UseFeedReturn {
  const [feed, setFeed] = useState<PodcastFeed | null>(null);
  const [episodes, setEpisodes] = useState<FeedEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);

    fetch(`/api/feeds/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch feed (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setFeed(data.feed ?? null);
          setEpisodes(data.episodes ?? []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to fetch feed");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setInitialLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [id, tick]);

  return { feed, episodes, loading, initialLoading, error, refresh };
}

// ── useAddFeed ──────────────────────────────────────────────

export function useAddFeed() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFeed = useCallback(async (feedUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add feed");
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add feed";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { addFeed, loading, error };
}

// ── useImportOpml ───────────────────────────────────────────

export function useImportOpml() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importOpml = useCallback(async (opml: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/feeds/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opml }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to import OPML");
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to import OPML";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { importOpml, loading, error };
}

// ── usePollFeed ─────────────────────────────────────────────

export function usePollFeed() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async (feedId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/feeds/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feedId ? { feedId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to poll feeds");
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to poll feeds";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { poll, loading, error };
}

// ── useDeleteFeed ───────────────────────────────────────────

export function useDeleteFeed() {
  const [loading, setLoading] = useState(false);

  const deleteFeed = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/feeds/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to delete feed");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return { deleteFeed, loading };
}

// ── useUpdateFeed ───────────────────────────────────────────

export function useUpdateFeed() {
  const [loading, setLoading] = useState(false);

  const updateFeed = useCallback(async (id: string, data: UpdateFeedInput) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/feeds/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to update feed");
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  return { updateFeed, loading };
}
