"use client";

import { useState, useEffect, useCallback } from "react";
import type { SummaryConfig, SummaryGenerationLog } from "@/types/feed";
import type { CreateSummaryConfigInput, UpdateSummaryConfigInput } from "@/lib/validation/feed-schemas";

// ── useSummaryConfigs ───────────────────────────────────────

export function useSummaryConfigs() {
  const [configs, setConfigs] = useState<SummaryConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch("/api/summary-configs")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch configs (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setConfigs(data.configs ?? []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to fetch configs");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [tick]);

  return { configs, loading, error, refresh };
}

// ── useSummaryConfig ────────────────────────────────────────

export function useSummaryConfig(id: string) {
  const [config, setConfig] = useState<SummaryConfig | null>(null);
  const [feedIds, setFeedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<SummaryGenerationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);

    fetch(`/api/summary-configs/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch config (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setConfig(data.config ?? null);
          setFeedIds(data.feedIds ?? []);
          setHistory(data.history ?? []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to fetch config");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id, tick]);

  return { config, feedIds, history, loading, error, refresh };
}

// ── useCreateSummaryConfig ──────────────────────────────────

export function useCreateSummaryConfig() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (data: CreateSummaryConfigInput) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/summary-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to create config");
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create config";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { create, loading, error };
}

// ── useUpdateSummaryConfig ──────────────────────────────────

export function useUpdateSummaryConfig() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (id: string, data: UpdateSummaryConfigInput) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/summary-configs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to update config");
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update config";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { update, loading, error };
}

// ── useDeleteSummaryConfig ──────────────────────────────────

export function useDeleteSummaryConfig() {
  const [loading, setLoading] = useState(false);

  const remove = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/summary-configs/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to delete config");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return { remove, loading };
}

// ── useGenerateSummary ──────────────────────────────────────

export function useGenerateSummary() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (summaryConfigId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaryConfigId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate summary");
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate summary";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { generate, loading, error };
}
