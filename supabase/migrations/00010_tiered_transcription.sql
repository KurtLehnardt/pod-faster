-- Migration: Tiered Transcription Limits
-- Adds partial transcript tracking and RPC functions for monthly cost / weekly clip counts.

-- ── New columns on feed_episodes ────────────────────────────

ALTER TABLE public.feed_episodes
  ADD COLUMN is_partial_transcript BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.feed_episodes
  ADD COLUMN transcript_clip_range TEXT;

COMMENT ON COLUMN public.feed_episodes.is_partial_transcript
  IS 'True when transcript covers only a clip (free-tier 5-min preview).';

COMMENT ON COLUMN public.feed_episodes.transcript_clip_range
  IS 'Start-end seconds of the transcribed clip, e.g. "300-600".';

-- ── RPC: stt_monthly_cost ───────────────────────────────────
-- Returns total elevenlabs_cost_cents for the current calendar month.

CREATE OR REPLACE FUNCTION public.stt_monthly_cost(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(elevenlabs_cost_cents), 0)
  FROM public.feed_episodes
  WHERE user_id = p_user_id
    AND transcript_source = 'elevenlabs_stt'
    AND created_at >= date_trunc('month', now());
$$;

-- ── RPC: stt_weekly_count ───────────────────────────────────
-- Returns count of partial transcriptions this ISO week (Mon-Sun).

CREATE OR REPLACE FUNCTION public.stt_weekly_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(COUNT(*)::INTEGER, 0)
  FROM public.feed_episodes
  WHERE user_id = p_user_id
    AND transcript_source = 'elevenlabs_stt'
    AND is_partial_transcript = true
    AND created_at >= date_trunc('week', now());
$$;

-- ── Restrict RPC access to service_role only ──────────────
-- Prevents any authenticated user from querying other users' cost data via PostgREST.

REVOKE EXECUTE ON FUNCTION public.stt_monthly_cost(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stt_monthly_cost(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.stt_weekly_count(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stt_weekly_count(UUID) TO service_role;
