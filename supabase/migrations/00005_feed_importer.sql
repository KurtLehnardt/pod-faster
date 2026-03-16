-- 00005_feed_importer.sql
-- Tables, RLS policies, indexes, and triggers for the podcast feed importer feature.

-- ============================================================
-- NEW TABLES
-- ============================================================

-- podcast_feeds: RSS subscriptions per user
CREATE TABLE public.podcast_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feed_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  image_url TEXT,
  last_polled_at TIMESTAMPTZ,
  last_episode_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  poll_error TEXT,
  poll_error_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, feed_url)
);

COMMENT ON TABLE public.podcast_feeds IS 'RSS feed subscriptions tracked per user for podcast content import.';

-- feed_episodes: individual episodes discovered from feeds
CREATE TABLE public.feed_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES public.podcast_feeds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  audio_url TEXT,
  published_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  transcript TEXT,
  transcript_source TEXT CHECK (transcript_source IN ('rss_description', 'podcast_index', 'elevenlabs_stt', 'manual')),
  transcription_status TEXT DEFAULT 'none' CHECK (transcription_status IN ('none', 'pending', 'processing', 'completed', 'failed')),
  transcription_error TEXT,
  elevenlabs_cost_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(feed_id, guid)
);

COMMENT ON TABLE public.feed_episodes IS 'Individual episodes discovered from RSS feeds, with transcription state tracking.';

-- summary_configs: user preferences for auto-generated summary podcasts
CREATE TABLE public.summary_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'My Summary Podcast',
  cadence TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily', 'twice_weekly', 'weekly', 'on_new_episodes')),
  preferred_time TEXT DEFAULT '08:00',
  timezone TEXT DEFAULT 'America/New_York',
  style TEXT NOT NULL DEFAULT 'monologue' CHECK (style IN ('monologue', 'interview', 'group_chat')),
  tone TEXT NOT NULL DEFAULT 'serious' CHECK (tone IN ('serious', 'lighthearted', 'dark_mystery', 'business_news')),
  length_minutes INTEGER NOT NULL DEFAULT 10 CHECK (length_minutes BETWEEN 1 AND 60),
  voice_config JSONB,
  is_active BOOLEAN DEFAULT true,
  last_generated_at TIMESTAMPTZ,
  next_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.summary_configs IS 'User-defined configurations for automated summary podcast generation.';

-- summary_config_feeds: junction table linking summary configs to feeds
CREATE TABLE public.summary_config_feeds (
  summary_config_id UUID NOT NULL REFERENCES public.summary_configs(id) ON DELETE CASCADE,
  feed_id UUID NOT NULL REFERENCES public.podcast_feeds(id) ON DELETE CASCADE,
  is_included BOOLEAN DEFAULT true,
  auto_excluded BOOLEAN DEFAULT false,
  auto_exclude_reason TEXT,
  PRIMARY KEY (summary_config_id, feed_id)
);

COMMENT ON TABLE public.summary_config_feeds IS 'Junction table linking summary configs to podcast feeds with inclusion/exclusion state.';

-- summary_generation_log: audit trail for summary generation runs
CREATE TABLE public.summary_generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_config_id UUID NOT NULL REFERENCES public.summary_configs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES public.episodes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  feeds_included INTEGER DEFAULT 0,
  feeds_excluded INTEGER DEFAULT 0,
  episodes_summarized INTEGER DEFAULT 0,
  claude_tokens_used INTEGER DEFAULT 0,
  elevenlabs_characters_used INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.summary_generation_log IS 'Audit trail tracking each summary generation run with cost and outcome metrics.';

-- ============================================================
-- ALTER episodes TABLE
-- ============================================================

ALTER TABLE public.episodes
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'topic' CHECK (source_type IN ('topic', 'feed_summary')),
  ADD COLUMN summary_config_id UUID REFERENCES public.summary_configs(id) ON DELETE SET NULL;

CREATE INDEX idx_episodes_source_type ON public.episodes (user_id, source_type);

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- podcast_feeds
ALTER TABLE public.podcast_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own feeds"
  ON public.podcast_feeds FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own feeds"
  ON public.podcast_feeds FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own feeds"
  ON public.podcast_feeds FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own feeds"
  ON public.podcast_feeds FOR DELETE
  USING (auth.uid() = user_id);

-- feed_episodes
ALTER TABLE public.feed_episodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own feed episodes"
  ON public.feed_episodes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own feed episodes"
  ON public.feed_episodes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own feed episodes"
  ON public.feed_episodes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own feed episodes"
  ON public.feed_episodes FOR DELETE
  USING (auth.uid() = user_id);

-- summary_configs
ALTER TABLE public.summary_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own summary configs"
  ON public.summary_configs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own summary configs"
  ON public.summary_configs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own summary configs"
  ON public.summary_configs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own summary configs"
  ON public.summary_configs FOR DELETE
  USING (auth.uid() = user_id);

-- summary_config_feeds (ownership via summary_configs.user_id)
ALTER TABLE public.summary_config_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own summary config feeds"
  ON public.summary_config_feeds FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.summary_configs sc
    WHERE sc.id = summary_config_id AND sc.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert their own summary config feeds"
  ON public.summary_config_feeds FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.summary_configs sc
    WHERE sc.id = summary_config_id AND sc.user_id = auth.uid()
  ));

CREATE POLICY "Users can update their own summary config feeds"
  ON public.summary_config_feeds FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.summary_configs sc
    WHERE sc.id = summary_config_id AND sc.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.summary_configs sc
    WHERE sc.id = summary_config_id AND sc.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete their own summary config feeds"
  ON public.summary_config_feeds FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.summary_configs sc
    WHERE sc.id = summary_config_id AND sc.user_id = auth.uid()
  ));

-- summary_generation_log (SELECT only for users; insert/update via admin client)
ALTER TABLE public.summary_generation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own generation logs"
  ON public.summary_generation_log FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- INDEXES
-- ============================================================

-- podcast_feeds
CREATE INDEX idx_podcast_feeds_user_id ON public.podcast_feeds (user_id);
CREATE INDEX idx_podcast_feeds_active_poll ON public.podcast_feeds (is_active, last_polled_at) WHERE is_active = true;

-- feed_episodes
CREATE INDEX idx_feed_episodes_feed_id ON public.feed_episodes (feed_id);
CREATE INDEX idx_feed_episodes_user_id ON public.feed_episodes (user_id);
CREATE INDEX idx_feed_episodes_feed_published ON public.feed_episodes (feed_id, published_at DESC);
CREATE INDEX idx_feed_episodes_transcription ON public.feed_episodes (transcription_status) WHERE transcription_status IN ('pending', 'processing');

-- summary_configs
CREATE INDEX idx_summary_configs_user_id ON public.summary_configs (user_id);
CREATE INDEX idx_summary_configs_next_due ON public.summary_configs (next_due_at) WHERE is_active = true;

-- summary_generation_log
CREATE INDEX idx_summary_gen_log_config_started ON public.summary_generation_log (summary_config_id, started_at DESC);

-- ============================================================
-- TRIGGERS (reuse existing handle_updated_at function)
-- ============================================================

CREATE TRIGGER on_podcast_feeds_updated
  BEFORE UPDATE ON public.podcast_feeds
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER on_summary_configs_updated
  BEFORE UPDATE ON public.summary_configs
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
