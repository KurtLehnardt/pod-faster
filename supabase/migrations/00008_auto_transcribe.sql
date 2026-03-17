-- Migration: 00008_auto_transcribe
--
-- Adds auto_transcribe toggle to podcast_feeds and subscription_tier to profiles.
-- auto_transcribe controls whether new feed episodes are automatically sent for
-- STT transcription. subscription_tier gates access to premium features like
-- auto-transcription (checked via the feature-gate helper in application code).
--
-- No index on auto_transcribe — the column is only read per-feed during polling,
-- not used as a query filter across all feeds.

ALTER TABLE public.podcast_feeds
  ADD COLUMN auto_transcribe BOOLEAN DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN subscription_tier TEXT DEFAULT 'premium'
    CHECK (subscription_tier IN ('free', 'pro', 'premium'));
