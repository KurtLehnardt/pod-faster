"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { EpisodeStatus } from "@/types/episode";

const POLL_INTERVAL_MS = 2000;

const TERMINAL_STATUSES: EpisodeStatus[] = ["completed", "failed"];

export interface EpisodeData {
  id: string;
  status: EpisodeStatus;
  topic_query: string;
  style: string;
  tone: string;
  length_minutes: number;
  audio_url?: string | null;
  audio_path?: string | null;
  error_message?: string | null;
  script?: unknown;
  created_at: string;
  updated_at?: string;
}

export interface UseEpisodeStatusReturn {
  episode: EpisodeData | null;
  isLoading: boolean;
  error: string | null;
  isComplete: boolean;
  isFailed: boolean;
}

/**
 * Polls GET /api/episodes/[id] every 2 seconds.
 * Stops polling when status is 'completed' or 'failed'.
 */
export function useEpisodeStatus(
  episodeId: string | null
): UseEpisodeStatusReturn {
  const [episode, setEpisode] = useState<EpisodeData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!episodeId) {
      setEpisode(null);
      setIsLoading(false);
      setError(null);
      clearPolling();
      return;
    }

    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}`);
        if (cancelled) return;

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `Failed to fetch episode (${res.status})`);
        }

        const data = await res.json();
        if (cancelled) return;

        const ep = data.episode as EpisodeData;
        setEpisode(ep);
        setError(null);

        // Stop polling on terminal statuses
        if (TERMINAL_STATUSES.includes(ep.status)) {
          clearPolling();
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch episode status");
      }
    };

    setIsLoading(true);
    fetchStatus().finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    // Start polling
    intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearPolling();
    };
  }, [episodeId, clearPolling]);

  const isComplete = episode?.status === "completed";
  const isFailed = episode?.status === "failed";

  return { episode, isLoading, error, isComplete, isFailed };
}
