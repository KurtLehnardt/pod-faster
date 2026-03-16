-- =============================================================================
-- Migration: 00006_spotify_integration
-- Description: Add tables for Spotify OAuth tokens and podcast subscriptions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: spotify_tokens
-- Stores encrypted Spotify OAuth tokens per user. One row per user.
-- ---------------------------------------------------------------------------
CREATE TABLE public.spotify_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  spotify_user_id text NOT NULL,
  spotify_display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spotify_tokens_user_id_unique UNIQUE (user_id)
);

-- RLS
ALTER TABLE public.spotify_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own spotify tokens"
  ON public.spotify_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages spotify tokens"
  ON public.spotify_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Table: spotify_subscriptions
-- Stores imported Spotify podcast subscriptions with per-show preferences.
-- ---------------------------------------------------------------------------
CREATE TABLE public.spotify_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  spotify_show_id text NOT NULL,
  show_name text NOT NULL,
  publisher text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  image_url text,
  spotify_url text NOT NULL DEFAULT '',
  total_episodes integer NOT NULL DEFAULT 0,
  summarization_enabled boolean NOT NULL DEFAULT true,
  is_removed boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spotify_subscriptions_user_show_unique UNIQUE (user_id, spotify_show_id)
);

-- RLS
ALTER TABLE public.spotify_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own spotify subscriptions"
  ON public.spotify_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own spotify subscriptions"
  ON public.spotify_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages spotify subscriptions"
  ON public.spotify_subscriptions FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX idx_spotify_subscriptions_user_id
  ON public.spotify_subscriptions (user_id);

-- idx_spotify_subscriptions_user_show removed: already created by
-- UNIQUE constraint spotify_subscriptions_user_show_unique

CREATE INDEX idx_spotify_subscriptions_user_active
  ON public.spotify_subscriptions (user_id)
  WHERE is_removed = false;

-- idx_spotify_tokens_user_id removed: already created by
-- UNIQUE constraint spotify_tokens_user_id_unique

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on spotify_tokens
-- ---------------------------------------------------------------------------
CREATE TRIGGER update_spotify_tokens_updated_at
  BEFORE UPDATE ON public.spotify_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on spotify_subscriptions
-- ---------------------------------------------------------------------------
CREATE TRIGGER update_spotify_subscriptions_updated_at
  BEFORE UPDATE ON public.spotify_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
