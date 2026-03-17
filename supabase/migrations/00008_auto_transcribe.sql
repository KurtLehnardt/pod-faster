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
  ADD COLUMN auto_transcribe BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'pro', 'premium'));

-- Prevent users from self-promoting their subscription tier.
-- Only service_role (admin client / Stripe webhooks) can modify this column.
CREATE OR REPLACE FUNCTION public.guard_subscription_tier()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.subscription_tier IS DISTINCT FROM NEW.subscription_tier
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    NEW.subscription_tier := OLD.subscription_tier;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guard_subscription_tier
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_tier();
