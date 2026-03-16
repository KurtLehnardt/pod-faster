-- Migration: Add source tracking to podcast_feeds
-- Allows distinguishing Spotify-synced feeds from manually imported ones.

-- Add source column with default 'imported' for existing feeds
ALTER TABLE podcast_feeds
  ADD COLUMN source TEXT NOT NULL DEFAULT 'imported'
    CHECK (source IN ('imported', 'spotify'));

-- Add spotify_show_id to link back to spotify_subscriptions
ALTER TABLE podcast_feeds
  ADD COLUMN spotify_show_id TEXT;

-- Index for source filter queries
CREATE INDEX idx_podcast_feeds_source ON podcast_feeds (source);

-- Unique constraint: one feed per Spotify show per user
CREATE UNIQUE INDEX idx_podcast_feeds_user_spotify_show
  ON podcast_feeds (user_id, spotify_show_id)
  WHERE spotify_show_id IS NOT NULL;
