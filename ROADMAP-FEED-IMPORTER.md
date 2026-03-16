# Podcast Feed Importer — Feature Roadmap

## Overview

Allow users to import their existing podcast subscriptions via RSS/OPML, track new episodes, optionally transcribe them (free: use existing transcripts; premium: ElevenLabs STT), and auto-generate summary podcasts on a user-defined cadence.

Summary podcasts are stored as regular `episodes` rows (with a new `source_type = 'feed_summary'` discriminator), reusing the full existing episode pipeline for audio generation, storage, playback, and history.

---

## Architecture

### Data Flow

```
User imports OPML/RSS URLs
  → Validate URLs (allowlist: http/https only, no private IPs — SSRF protection)
  → Parse feeds with battle-tested library (rss-parser), store subscriptions
  → Enforce per-user feed limit (50 feeds max)
  → Poll for new episodes (cron or on-demand)
  → For each new episode:
      → Check for existing transcript (show notes, podcast index)
      → If no transcript + user is premium → ElevenLabs STT
      → Store transcript (truncated to 500KB max per episode)
  → When trigger fires (cadence reached OR all selected feeds have new eps):
      → Gather transcripts from selected feeds (since last summary)
      → Window transcripts to fit context (max 100K tokens input)
      → Summarize via Claude (new podcast-summary prompt)
      → Generate script (reuse existing script-step pattern)
      → Generate audio (reuse existing audio-step pattern)
      → Upload (reuse existing storage-step pattern)
      → Create episodes row with source_type='feed_summary'
      → Update summary_config.last_generated_at + next_due_at
      → Notify user (in-app — mark summary as new in episode list)
```

### Episode Table Extension

The summary pipeline produces a row in the existing `episodes` table, not a separate table. This reuses all existing playback, history, and UI infrastructure. A new column distinguishes summary episodes from topic-based episodes:

```sql
-- Added to episodes table via migration
ALTER TABLE public.episodes
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'topic'
    CHECK (source_type IN ('topic', 'feed_summary')),
  ADD COLUMN summary_config_id UUID REFERENCES public.summary_configs(id) ON DELETE SET NULL;

-- Index for filtering
CREATE INDEX idx_episodes_source_type ON public.episodes (user_id, source_type);
```

### New Database Tables

```sql
-- podcast_feeds: RSS subscriptions
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
  poll_error_count INTEGER DEFAULT 0,  -- consecutive errors, for backoff
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, feed_url)
);

-- feed_episodes: individual episodes from feeds
CREATE TABLE public.feed_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES public.podcast_feeds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,  -- denormalized for RLS (cannot join in RLS policies)
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
  elevenlabs_cost_cents INTEGER DEFAULT 0,  -- track STT cost per episode
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(feed_id, guid)
);

-- summary_configs: user's auto-generation preferences
CREATE TABLE public.summary_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'My Summary Podcast',
  cadence TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily', 'twice_weekly', 'weekly', 'on_new_episodes')),
  preferred_time TEXT DEFAULT '08:00',  -- HH:MM in user's timezone
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

-- summary_config_feeds: which feeds are included in which summary config
CREATE TABLE public.summary_config_feeds (
  summary_config_id UUID NOT NULL REFERENCES public.summary_configs(id) ON DELETE CASCADE,
  feed_id UUID NOT NULL REFERENCES public.podcast_feeds(id) ON DELETE CASCADE,
  is_included BOOLEAN DEFAULT true,
  auto_excluded BOOLEAN DEFAULT false,  -- system excluded due to inactivity
  auto_exclude_reason TEXT,
  PRIMARY KEY (summary_config_id, feed_id)
);

-- summary_generation_log: audit trail for each generation run
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
```

### RLS Policies (all 5 new tables)

Following the existing pattern from `00002_rls_policies.sql`:

```sql
-- ============================================================
-- podcast_feeds
-- ============================================================
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

-- ============================================================
-- feed_episodes (uses denormalized user_id for RLS)
-- ============================================================
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

-- ============================================================
-- summary_configs
-- ============================================================
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

-- ============================================================
-- summary_config_feeds (access via join on summary_config_id)
-- Users can manage their own config-feed links
-- ============================================================
ALTER TABLE public.summary_config_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own config feeds"
  ON public.summary_config_feeds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.summary_configs sc
      WHERE sc.id = summary_config_id AND sc.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own config feeds"
  ON public.summary_config_feeds FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.summary_configs sc
      WHERE sc.id = summary_config_id AND sc.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own config feeds"
  ON public.summary_config_feeds FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.summary_configs sc
      WHERE sc.id = summary_config_id AND sc.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own config feeds"
  ON public.summary_config_feeds FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.summary_configs sc
      WHERE sc.id = summary_config_id AND sc.user_id = auth.uid()
    )
  );

-- ============================================================
-- summary_generation_log
-- ============================================================
ALTER TABLE public.summary_generation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own generation logs"
  ON public.summary_generation_log FOR SELECT
  USING (auth.uid() = user_id);

-- Insert/update only via admin client (pipeline writes these)
```

### Indexes

Following the pattern from `00003_indexes.sql`:

```sql
-- podcast_feeds: filter by user
CREATE INDEX idx_podcast_feeds_user_id ON public.podcast_feeds (user_id);

-- podcast_feeds: find feeds due for polling
CREATE INDEX idx_podcast_feeds_active_poll ON public.podcast_feeds (is_active, last_polled_at)
  WHERE is_active = true;

-- feed_episodes: filter by feed
CREATE INDEX idx_feed_episodes_feed_id ON public.feed_episodes (feed_id);

-- feed_episodes: filter by user (for RLS)
CREATE INDEX idx_feed_episodes_user_id ON public.feed_episodes (user_id);

-- feed_episodes: find episodes since a date (for summary generation)
CREATE INDEX idx_feed_episodes_published ON public.feed_episodes (feed_id, published_at DESC);

-- feed_episodes: find episodes needing transcription
CREATE INDEX idx_feed_episodes_transcription ON public.feed_episodes (transcription_status)
  WHERE transcription_status IN ('pending', 'processing');

-- summary_configs: filter by user
CREATE INDEX idx_summary_configs_user_id ON public.summary_configs (user_id);

-- summary_configs: find configs due for generation
CREATE INDEX idx_summary_configs_next_due ON public.summary_configs (next_due_at)
  WHERE is_active = true;

-- summary_generation_log: filter by config
CREATE INDEX idx_summary_gen_log_config ON public.summary_generation_log (summary_config_id, started_at DESC);
```

### Triggers

Following existing pattern from `00001_initial_schema.sql`:

```sql
-- Auto-update updated_at on podcast_feeds
CREATE TRIGGER on_podcast_feeds_updated
  BEFORE UPDATE ON public.podcast_feeds
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Auto-update updated_at on summary_configs
CREATE TRIGGER on_summary_configs_updated
  BEFORE UPDATE ON public.summary_configs
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
```

### New Directory Structure (additions only)

```
src/
├── lib/
│   ├── rss/
│   │   ├── parser.ts          # RSS/OPML parsing
│   │   ├── poller.ts          # Feed polling logic
│   │   ├── transcript.ts      # Transcript extraction (show notes, podcast index API)
│   │   ├── url-validator.ts   # SSRF protection: validate feed URLs
│   │   └── __tests__/
│   │       ├── parser.test.ts
│   │       ├── poller.test.ts
│   │       ├── transcript.test.ts
│   │       ├── url-validator.test.ts
│   │       └── fixtures/       # Sample RSS, Atom, OPML files for testing
│   │           ├── sample-rss2.xml
│   │           ├── sample-atom.xml
│   │           ├── sample-opml.xml
│   │           ├── malformed-feed.xml
│   │           └── feed-with-transcript.xml
│   ├── transcription/
│   │   ├── elevenlabs-stt.ts  # ElevenLabs Speech-to-Text client
│   │   ├── orchestrator.ts    # Transcription job management
│   │   └── __tests__/
│   │       └── elevenlabs-stt.test.ts
│   ├── pipeline/
│   │   ├── summary-pipeline.ts # New pipeline: transcripts → summary podcast
│   │   └── __tests__/
│   │       └── summary-pipeline.test.ts
│   ├── ai/
│   │   └── prompts/
│   │       └── podcast-summary.ts  # Summary prompt for podcast transcripts
│   ├── validation/
│   │   └── feed-schemas.ts    # Zod schemas for feed API input validation
│   └── hooks/
│       ├── use-feeds.ts       # Feed subscription management
│       └── use-summary-config.ts # Summary config management
├── app/
│   ├── (app)/
│   │   └── feeds/
│   │       ├── page.tsx       # Feed management page
│   │       └── [id]/page.tsx  # Single feed detail
│   └── api/
│       ├── feeds/
│       │   ├── route.ts       # GET/POST feeds
│       │   ├── [id]/route.ts  # GET/PUT/DELETE single feed
│       │   ├── import/route.ts # POST OPML import
│       │   └── poll/route.ts  # POST trigger feed polling
│       ├── transcribe/
│       │   └── route.ts       # POST trigger transcription
│       ├── summary-configs/
│       │   ├── route.ts       # GET/POST summary configs
│       │   └── [id]/route.ts  # GET/PUT/DELETE config
│       ├── generate-summary/
│       │   └── route.ts       # POST trigger summary generation
│       └── cron/
│           └── generate-summaries/
│               └── route.ts   # Cron endpoint (Vercel Cron)
├── components/
│   └── feeds/
│       ├── feed-list.tsx      # List of subscribed feeds
│       ├── feed-card.tsx      # Individual feed card
│       ├── import-dialog.tsx  # OPML/RSS import dialog
│       ├── summary-config-form.tsx  # Configure summary podcast
│       └── feed-episode-list.tsx    # Episodes within a feed
└── types/
    └── feed.ts                # Feed, FeedEpisode, SummaryConfig types
```

### ElevenLabs Speech-to-Text

ElevenLabs offers a Speech-to-Text API:
- Endpoint: `POST https://api.elevenlabs.io/v1/speech-to-text`
- Accepts audio file upload (multipart/form-data) or audio URL
- Returns: `{ text: string, words: [{text, start, end, confidence}] }`
- Model: `eleven_flash_v2_5` (fastest, ~$0.40/hr) or `eleven_turbo_v2` (most accurate)
- Supports: mp3, wav, m4a, ogg, flac, webm
- Max file size: 1GB
- Cost: ~$0.40/hr of audio (~0.67 cents/min)

**Implementation approach**: Use `elevenLabsFetch` from `src/lib/elevenlabs/client.ts` (reuse existing retry + error handling). The STT client will:
1. Accept an audio URL (no download needed if ElevenLabs supports URL input; otherwise stream-download to a temp buffer)
2. Send multipart/form-data with the audio
3. Return the transcript text + word-level timestamps
4. Track cost: `Math.ceil(duration_seconds / 60) * 0.67` cents

**New env var**: `PODCAST_INDEX_API_KEY` and `PODCAST_INDEX_API_SECRET` (required for PodcastIndex.org API lookups). Add to `.env.example`.

This is the "premium" transcription option. For free users, we extract transcripts from:
1. RSS `<podcast:transcript>` tag (Podcasting 2.0 namespace)
2. Detailed show notes / description HTML (strip tags, use as fallback)
3. PodcastIndex.org API (free tier, has transcript links for many shows)

### Input Validation Strategy

All API routes use Zod schemas for request body validation. A shared `src/lib/validation/feed-schemas.ts` file exports schemas reused across routes:

```typescript
// Example schemas (implemented in T-F01, consumed by T-F05/T-F06)
export const feedUrlSchema = z.string().url().max(2048).refine(isAllowedUrl);
export const createFeedSchema = z.object({ feedUrl: feedUrlSchema });
export const importOpmlSchema = z.object({ opml: z.string().max(1_000_000) }); // 1MB max
export const createSummaryConfigSchema = z.object({
  name: z.string().min(1).max(100),
  cadence: z.enum(['daily', 'twice_weekly', 'weekly', 'on_new_episodes']),
  style: z.enum(['monologue', 'interview', 'group_chat']),
  tone: z.enum(['serious', 'lighthearted', 'dark_mystery', 'business_news']),
  lengthMinutes: z.number().int().min(1).max(60),
  voiceConfig: voiceConfigSchema.optional(),
  feedIds: z.array(z.string().uuid()).min(1).max(50),
});
```

### SSRF Protection

User-supplied RSS/OPML URLs are validated before any HTTP request:

```typescript
// src/lib/rss/url-validator.ts
// Rejects: private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, ::1, fc00::/7)
// Rejects: non-http(s) schemes (file://, ftp://, data:, javascript:)
// Rejects: URLs with authentication (user:pass@host)
// Rejects: URLs longer than 2048 chars
// Allows: only http:// and https:// to public IP ranges
// Resolves hostname to IP before checking (prevents DNS rebinding at fetch time
//   using a validated-URL-only fetch wrapper)
```

### Inactivity Detection

A feed is considered "inactive" if:
- No new episode in 30 days (configurable per summary_config in future)
- When a summary is due and an included feed has no new episodes since last summary:
  - Auto-exclude it from this generation cycle
  - Set `auto_excluded = true` with reason
  - Include a note in the summary: "Note: [Podcast Name] had no new episodes this cycle"
  - User can re-include manually
- A feed with 5+ consecutive poll errors is auto-deactivated (`is_active = false`)

### Cadence System

| Cadence | Behavior |
|---------|----------|
| daily | Generate every 24h at user's preferred_time in their timezone |
| twice_weekly | Mon + Thu at preferred_time |
| weekly | Every Monday at preferred_time |
| on_new_episodes | Generate when ALL included (non-excluded) feeds have >=1 new episode since last summary |

For MVP, cadence is triggered by:
1. A cron-like API route (`/api/cron/generate-summaries`) called by Vercel Cron
2. Or manual "Generate Now" button

**Cron endpoint security**: The cron route validates the `Authorization: Bearer <CRON_SECRET>` header. Vercel automatically sends this for cron jobs. The `CRON_SECRET` env var must be set. Unauthenticated requests return 401.

**next_due_at calculation**: After each generation (or on config creation), compute `next_due_at` based on cadence + preferred_time + timezone. The cron job queries `WHERE next_due_at <= now() AND is_active = true`.

### Cost Tracking and Controls

Following the existing pattern (`claude_tokens_used`, `elevenlabs_characters_used` on `episodes`), the feed importer tracks costs at multiple levels:

1. **Per-episode STT cost**: `feed_episodes.elevenlabs_cost_cents` — calculated from `duration_seconds`
2. **Per-generation run**: `summary_generation_log.claude_tokens_used` and `elevenlabs_characters_used`
3. **Per-user daily STT budget**: Enforced in the transcription orchestrator
   - Free users: 0 minutes/day (transcript extraction only)
   - Premium users: 120 minutes/day (configurable via env `STT_DAILY_LIMIT_MINUTES`)
   - Check: `SELECT SUM(duration_seconds) FROM feed_episodes WHERE user_id = ? AND transcription_status = 'completed' AND transcript_source = 'elevenlabs_stt' AND created_at > now() - interval '24 hours'`
4. **Pre-flight cost estimate**: Before triggering STT, show the user estimated cost based on episode duration. Require confirmation for episodes > 60 minutes.

**New env vars** (add to `.env.example`):
- `PODCAST_INDEX_API_KEY` — PodcastIndex.org API key
- `PODCAST_INDEX_API_SECRET` — PodcastIndex.org API secret
- `STT_DAILY_LIMIT_MINUTES=120` — per-user daily STT limit
- `CRON_SECRET` — Vercel cron authentication secret
- `MAX_FEEDS_PER_USER=50` — per-user feed subscription limit

---

## Task Breakdown

### Wave 0 — Schema + Types (no dependencies)

**T-F01: Database Migration + Types + Validation Schemas**
- New migration: `00005_feed_importer.sql` with:
  - All 5 tables (podcast_feeds, feed_episodes, summary_configs, summary_config_feeds, summary_generation_log)
  - ALTER episodes table to add `source_type` and `summary_config_id` columns
  - RLS policies for all 5 new tables (following `00002_rls_policies.sql` pattern exactly)
  - Indexes for all new tables (following `00003_indexes.sql` pattern)
  - `updated_at` triggers for podcast_feeds and summary_configs (reuse existing `handle_updated_at()`)
- New types file: `src/types/feed.ts` — TypeScript interfaces for all new tables
- Update `src/types/database.types.ts` — add new table types + update episodes type with source_type
- Update `src/types/episode.ts` — add `source_type` to EpisodeStatus-adjacent types if needed
- New validation schemas: `src/lib/validation/feed-schemas.ts` — Zod schemas for all API inputs
- New URL validator: `src/lib/rss/url-validator.ts` — SSRF protection
- Update `.env.example` with new env vars
- Files: `supabase/migrations/00005_feed_importer.sql`, `src/types/feed.ts`, `src/types/database.types.ts`, `src/lib/validation/feed-schemas.ts`, `src/lib/rss/url-validator.ts`, `.env.example`
- Tests: `src/lib/rss/__tests__/url-validator.test.ts`
- Complexity: L
- Max iterations: 40

### Wave 1 — Core Libraries (depends on T-F01, parallel within wave)

**T-F02: RSS/OPML Parser + Feed Poller**
- Parse RSS 2.0, Atom, and OPML feeds using `rss-parser` npm package
- Extract episodes with metadata (title, audio URL, published date, duration, guid)
- Extract transcripts from `<podcast:transcript>` tag (Podcasting 2.0 namespace) and show notes HTML
- PodcastIndex.org transcript lookup (using API key/secret from env)
- Feed polling: fetch new episodes since last poll, compare by guid
- URL validation via `url-validator.ts` before any fetch
- Handle edge cases: missing guid (fallback to audio_url hash), missing dates, malformed XML
- OPML parsing: extract feed URLs from `<outline>` elements, handle nested groups
- OPML size limit: reject files > 1MB
- Feed count limit: reject if user already at MAX_FEEDS_PER_USER
- Dep: install `rss-parser` (`npm install rss-parser`)
- Files: `src/lib/rss/parser.ts`, `src/lib/rss/poller.ts`, `src/lib/rss/transcript.ts`
- Tests: `src/lib/rss/__tests__/parser.test.ts`, `src/lib/rss/__tests__/poller.test.ts`, `src/lib/rss/__tests__/transcript.test.ts`
- Test fixtures: `src/lib/rss/__tests__/fixtures/sample-rss2.xml`, `sample-atom.xml`, `sample-opml.xml`, `malformed-feed.xml`, `feed-with-transcript.xml`
- Complexity: L
- Max iterations: 45

**T-F03: ElevenLabs Speech-to-Text Client**
- STT API client extending existing `elevenLabsFetch` from `src/lib/elevenlabs/client.ts`
- Accept audio URL, stream-download (Node.js streams, not buffer entire file in memory)
- Send multipart/form-data to ElevenLabs STT endpoint
- Return transcript text + confidence + duration estimate
- Track cost in cents: `Math.ceil(duration_seconds / 60) * 0.67`
- Transcription job orchestrator:
  - Process one episode at a time (prevent parallel STT calls hitting rate limits)
  - Check daily STT budget before starting (`STT_DAILY_LIMIT_MINUTES` env var)
  - Set `transcription_status` through lifecycle: pending -> processing -> completed/failed
  - Retry failed transcriptions up to 3 times with exponential backoff
  - Store error in `feed_episodes.transcription_error` on failure
- Files: `src/lib/transcription/elevenlabs-stt.ts`, `src/lib/transcription/orchestrator.ts`
- Tests: `src/lib/transcription/__tests__/elevenlabs-stt.test.ts`, `src/lib/transcription/__tests__/orchestrator.test.ts`
- Complexity: M
- Max iterations: 35

**T-F04: Summary Pipeline**
- New pipeline: gathers transcripts from feed_episodes -> Claude summarization -> script -> audio -> upload
- **Creates an `episodes` row** with `source_type='feed_summary'` and `summary_config_id` set
- Reuses existing `audioStep()` from `audio-step.ts` and `storageStep()` from `storage-step.ts` directly
- Reuses existing `scriptStep()` from `script-step.ts` with the podcast-summary output adapted to `NewsSummaryOutput` format
- New summarize prompt: `src/lib/ai/prompts/podcast-summary.ts` — optimized for podcast transcripts (not news articles), handles multiple source podcasts, attributes quotes
- Transcript windowing: if total transcript text exceeds 100K tokens, prioritize by recency and trim oldest
- Inactivity detection: check each included feed for new episodes since `last_generated_at`, auto-exclude inactive ones
- Writes to `summary_generation_log` for audit trail
- Tracks `claude_tokens_used` and `elevenlabs_characters_used` on both the episode row and the generation log
- **Depends on T-F02** (for transcript data structures) and **T-F03** (for transcription status checks) — but can be developed in parallel if interfaces are agreed upon in T-F01's types
- Files: `src/lib/pipeline/summary-pipeline.ts`, `src/lib/ai/prompts/podcast-summary.ts`
- Tests: `src/lib/pipeline/__tests__/summary-pipeline.test.ts`
- Complexity: L
- Max iterations: 45

### Wave 2 — API Routes (depends on Wave 1, parallel within wave)

**T-F05: Feed Management API Routes**
- `POST /api/feeds` — add a single RSS feed (validate URL via url-validator, parse feed metadata, insert podcast_feeds row)
- `GET /api/feeds` — list user's feeds with episode counts
- `GET /api/feeds/[id]` — single feed detail with recent episodes
- `PUT /api/feeds/[id]` — update feed (toggle is_active, rename)
- `DELETE /api/feeds/[id]` — delete feed and cascade episodes
- `POST /api/feeds/import` — OPML import (parse OPML, bulk-create feeds, enforce per-user limit, return created/skipped counts)
- `POST /api/feeds/poll` — trigger polling for a specific feed or all active feeds
- All routes: auth via `createClient()` from `src/lib/supabase/server.ts`, Zod validation from `feed-schemas.ts`
- All routes: rate limiting consideration — poll endpoint limited to 1 call per feed per 15 minutes (check `last_polled_at`)
- OPML import: limit to 50 feeds per import, reject if over user limit
- Files: `src/app/api/feeds/route.ts`, `src/app/api/feeds/[id]/route.ts`, `src/app/api/feeds/import/route.ts`, `src/app/api/feeds/poll/route.ts`
- Tests: `src/app/api/feeds/__tests__/route.test.ts`, `src/app/api/feeds/__tests__/import.test.ts`
- Complexity: L
- Max iterations: 40

**T-F06: Summary Config + Generation API Routes**
- `POST /api/summary-configs` — create summary config + link feeds
- `GET /api/summary-configs` — list user's configs
- `GET /api/summary-configs/[id]` — single config with linked feeds
- `PUT /api/summary-configs/[id]` — update config (cadence, feeds, style, etc.)
- `DELETE /api/summary-configs/[id]` — delete config
- `POST /api/generate-summary` — trigger summary generation for a config (manual "Generate Now")
  - Validate config ownership
  - Check at least 1 included feed has transcripts since last generation
  - Run summary pipeline (fire-and-forget like existing `/api/generate` pattern)
  - Return the created episode ID for status polling
- `POST /api/transcribe` — trigger transcription for a specific feed_episode
  - Validate ownership, check premium status, check daily budget
  - Queue transcription via orchestrator
- `GET /api/cron/generate-summaries` — Vercel Cron endpoint
  - Validate `Authorization: Bearer <CRON_SECRET>` header
  - Query `summary_configs WHERE is_active = true AND next_due_at <= now()`
  - For each due config: trigger summary pipeline, update `next_due_at`
  - Idempotent: skip if `last_generated_at` is within cadence window
  - `maxDuration = 300` (same as existing generate route)
- All routes: Zod validation, auth enforcement
- Files: `src/app/api/summary-configs/route.ts`, `src/app/api/summary-configs/[id]/route.ts`, `src/app/api/generate-summary/route.ts`, `src/app/api/transcribe/route.ts`, `src/app/api/cron/generate-summaries/route.ts`
- Tests: `src/app/api/summary-configs/__tests__/route.test.ts`, `src/app/api/generate-summary/__tests__/route.test.ts`
- Complexity: L
- Max iterations: 45

### Wave 3 — UI (depends on Wave 2, parallel within wave)

**T-F07: Feed Management UI**
- Feeds page with list of subscriptions (title, image, episode count, last updated, status indicator)
- Import dialog (two modes: paste RSS URL, or upload/paste OPML file)
  - Show progress during OPML import (X of Y feeds added)
  - Show validation errors inline (invalid URLs, duplicate feeds)
- Feed card with episode count, last polled, error indicator, active/paused toggle
- Feed detail page with episode list + transcript status (none/pending/completed/failed)
- "Poll Now" button on feed detail page
- Loading states, error states, empty states for all views
- Hooks: `src/lib/hooks/use-feeds.ts` (SWR or React Query pattern matching existing hooks)
- Files: `src/app/(app)/feeds/page.tsx`, `src/app/(app)/feeds/[id]/page.tsx`, `src/components/feeds/feed-list.tsx`, `src/components/feeds/feed-card.tsx`, `src/components/feeds/import-dialog.tsx`, `src/components/feeds/feed-episode-list.tsx`
- Complexity: L
- Max iterations: 45

**T-F08: Summary Config UI + Sidebar Nav Update**
- Summary podcast configuration form:
  - Name input
  - Cadence selector (dropdown)
  - Preferred time picker
  - Style + tone selectors (reuse existing pattern from episode creation)
  - Length slider (1-60 minutes)
  - Feed inclusion checkboxes (list all user feeds, check/uncheck)
  - Voice config selector (reuse existing voice preset UI)
- "Generate Now" button with confirmation dialog (shows estimated cost)
- Progress indicator (reuse GenerationProgress pattern from existing episode creation)
- Generation history list (from summary_generation_log)
- Add "Feeds" link to sidebar navigation (insert between "Topics" and "Settings" in `navItems` array)
  - Icon: `Rss` from lucide-react
- **Note**: sidebar.tsx is a shared file. The change is minimal (add one entry to `navItems` array). No other task modifies this file.
- Hooks: `src/lib/hooks/use-summary-config.ts`
- Files: `src/components/feeds/summary-config-form.tsx`, `src/components/layout/sidebar.tsx` (modify), `src/lib/hooks/use-summary-config.ts`
- Complexity: L
- Max iterations: 45

### Wave 4 — Integration + Polish (depends on all prior)

**T-F09: Integration Tests + Validation + database.types.ts Verification**
- End-to-end journey test: import OPML -> verify feeds created -> poll feeds -> verify episodes stored -> trigger transcription -> verify transcript saved -> trigger summary generation -> verify episode created with source_type='feed_summary'
- Edge case tests:
  - Empty feed (no episodes)
  - Feed with only audio, no transcripts (should show "no transcript" status)
  - Failed transcription (budget exceeded, API error)
  - Inactive feeds (auto-excluded from summary)
  - Duplicate feed import (should skip gracefully)
  - Malformed RSS feed (should store error, not crash)
  - OPML with 100+ feeds (should reject over limit)
  - Concurrent summary generation (idempotency check)
  - Summary with zero new transcripts (should not generate empty episode)
- Cadence logic tests: verify next_due_at calculation for all cadence types across timezones
- URL validator tests: SSRF prevention (private IPs, localhost, non-http schemes)
- Verify `database.types.ts` matches migration (all new tables present)
- Full build + typecheck + test validation: `npm test && npm run build && npx tsc --noEmit`
- Files: `src/__tests__/journeys/feed-importer.test.ts`, `src/lib/pipeline/__tests__/summary-pipeline-integration.test.ts`
- Complexity: L
- Max iterations: 45

---

## Dependency Graph

```
Wave 0:  T-F01 (schema + types + validation + url-validator)
              |
              +----------------------------------+----------------------------------+
              |                                  |                                  |
Wave 1:  T-F02 (RSS parser)              T-F03 (ElevenLabs STT)            T-F04 (summary pipeline)
              |                                  |                                  |
              |                                  |                       (depends on T-F02 + T-F03
              |                                  |                        for type interfaces only;
              |                                  |                        can develop in parallel)
              +------------------+               |                                  |
              |                  |               |                                  |
Wave 2:  T-F05 (feed API) <-----+---------------+                    T-F06 (config + gen API) <-- T-F04
              |                                                              |
              |                                                              |
Wave 3:  T-F07 (feed UI) <-- T-F05                                   T-F08 (config UI) <-- T-F06
              |                                                              |
              +--------------------------------------------------------------+
              |
Wave 4:  T-F09 (integration tests) <-- (all prior)
```

### File Ownership (No Collisions)

| Task | Owns (creates/modifies) | Reads only |
|------|------------------------|------------|
| T-F01 | `supabase/migrations/00005_*`, `src/types/feed.ts`, `src/types/database.types.ts` (add new table types), `src/lib/validation/feed-schemas.ts`, `src/lib/rss/url-validator.ts`, `.env.example` | existing migrations, `src/types/episode.ts` |
| T-F02 | `src/lib/rss/parser.ts`, `src/lib/rss/poller.ts`, `src/lib/rss/transcript.ts`, `src/lib/rss/__tests__/*`, `src/lib/rss/__tests__/fixtures/*` | `src/types/feed.ts`, `src/lib/rss/url-validator.ts`, `src/lib/validation/feed-schemas.ts` |
| T-F03 | `src/lib/transcription/elevenlabs-stt.ts`, `src/lib/transcription/orchestrator.ts`, `src/lib/transcription/__tests__/*` | `src/lib/elevenlabs/client.ts`, `src/types/feed.ts` |
| T-F04 | `src/lib/pipeline/summary-pipeline.ts`, `src/lib/ai/prompts/podcast-summary.ts`, `src/lib/pipeline/__tests__/summary-pipeline.test.ts` | `src/lib/pipeline/orchestrator.ts`, `src/lib/pipeline/audio-step.ts`, `src/lib/pipeline/storage-step.ts`, `src/lib/pipeline/script-step.ts`, `src/lib/ai/prompts/news-summary.ts`, `src/types/feed.ts`, `src/types/episode.ts` |
| T-F05 | `src/app/api/feeds/*`, `src/app/api/feeds/__tests__/*` | `src/lib/rss/*`, `src/types/feed.ts`, `src/lib/validation/feed-schemas.ts` |
| T-F06 | `src/app/api/summary-configs/*`, `src/app/api/generate-summary/*`, `src/app/api/transcribe/*`, `src/app/api/cron/*`, `src/app/api/summary-configs/__tests__/*`, `src/app/api/generate-summary/__tests__/*` | `src/lib/pipeline/summary-pipeline.ts`, `src/lib/transcription/*`, `src/lib/validation/feed-schemas.ts` |
| T-F07 | `src/app/(app)/feeds/*`, `src/components/feeds/feed-list.tsx`, `src/components/feeds/feed-card.tsx`, `src/components/feeds/import-dialog.tsx`, `src/components/feeds/feed-episode-list.tsx`, `src/lib/hooks/use-feeds.ts` | `src/types/feed.ts` |
| T-F08 | `src/components/feeds/summary-config-form.tsx`, `src/lib/hooks/use-summary-config.ts`, **`src/components/layout/sidebar.tsx`** (add 1 nav item) | `src/types/feed.ts` |
| T-F09 | `src/__tests__/journeys/feed-importer.test.ts`, `src/lib/pipeline/__tests__/summary-pipeline-integration.test.ts` | everything (read-only) |

**Collision risk**: `sidebar.tsx` is modified by T-F08 only. The change is additive (one entry in the `navItems` array). No other feed importer task touches it. If another feature branch modifies sidebar.tsx concurrently, the merge conflict is trivial (different array entries).

**Collision risk**: `src/types/database.types.ts` is modified by T-F01 only. Other tasks read it. If another migration modifies this file on main, T-F01's changes are additive (new table definitions) and merge cleanly.

---

## Risks

1. **RSS feed variability**: Feeds use inconsistent formats (RSS 2.0, Atom, some non-standard). Mitigation: use `rss-parser` npm package (battle-tested, handles most variants). Add a malformed-feed test fixture. Wrap parsing in try-catch and store `poll_error` on failure.

2. **Large audio files for STT**: Podcast episodes can be 1-2 hours (100-200MB). ElevenLabs accepts up to 1GB. Mitigation: stream download using Node.js readable streams, pipe directly to the API request body. Never buffer entire file in serverless memory. Set a maximum episode duration of 3 hours (reject longer).

3. **Vercel timeout for transcription**: STT on a 1-hour podcast may exceed Vercel's 300s function timeout. Mitigation: transcribe asynchronously — the API route sets `transcription_status = 'pending'` and returns immediately. A separate cron job or on-demand trigger picks up pending transcriptions one at a time. Each transcription runs in its own function invocation.

4. **Vercel timeout for summary generation**: Generating a summary from many transcripts (summarize + script + audio + upload) may exceed 300s. Mitigation: the summary pipeline is the same pattern as existing `runPipeline` in `orchestrator.ts` which already uses `maxDuration = 300`. If it times out, the episode status is set to 'failed' and can be retried. For MVP, accept this limitation. Future: break into queued steps.

5. **ElevenLabs STT cost**: ~$0.40/hr. A power user with 20 subscriptions averaging 1 hr/episode = $8/day. Mitigation: premium-only, daily per-user budget (`STT_DAILY_LIMIT_MINUTES`), pre-flight cost estimate with confirmation, prefer free transcript sources first.

6. **Cron reliability on Vercel**: Vercel Cron has minimum 1-minute granularity and may skip or fire late. Mitigation: idempotent generation (check `last_generated_at` before running), use `next_due_at` comparison (not exact time match). If cron fires twice, the second invocation sees `last_generated_at` is recent and skips.

7. **Feed polling rate**: Too aggressive = IP blocks or bandwidth waste. Mitigation: respect RSS `<ttl>` element, enforce minimum 15-minute poll interval (check `last_polled_at`), exponential backoff on errors (double interval per consecutive error, max 24h), auto-deactivate after 5 consecutive errors.

8. **SSRF via user-supplied URLs**: Users could submit RSS URLs pointing to internal services (169.254.x.x metadata, 10.x.x.x internal APIs, localhost). Mitigation: `url-validator.ts` resolves hostname to IP and blocks private/reserved ranges before any HTTP request. Only allow http:// and https:// schemes. Block URLs with embedded credentials.

9. **XML External Entity (XXE) attacks**: Malicious RSS/OPML XML could include external entity references to exfiltrate data. Mitigation: `rss-parser` uses `sax` under the hood which does not expand external entities by default. Add explicit test for XXE payloads in parser tests. If using raw XML parsing anywhere, disable entity expansion explicitly.

10. **Transcript storage size**: A 1-hour episode transcript can be 8,000-15,000 words (~50-100KB). Storing raw text for hundreds of episodes per user could grow large. Mitigation: truncate transcripts to 500KB max per episode. For summary generation, window transcripts to fit Claude's context (max ~100K tokens input). Use text-only storage (no word-level timestamps in DB — those are discarded after STT).

11. **PodcastIndex API availability**: PodcastIndex is a community service and may have rate limits or downtime. Mitigation: treat as optional enhancement. If PodcastIndex lookup fails, fall back to RSS transcript tag or show-notes-only. Cache successful lookups. Respect their rate limits (documented at 300 req/15min).

12. **Feed URL redirect chains**: Some feed URLs redirect multiple times (e.g., Feedburner to actual host). Mitigation: follow redirects (up to 5 hops max), store the final resolved URL. Validate the final URL against SSRF rules, not just the initial URL.

---

## Test Strategy

### Unit Tests (per task)

Each Wave 1 task includes unit tests with mocked dependencies:

- **T-F02 tests**: Parse sample RSS 2.0, Atom, OPML fixtures. Test malformed XML handling. Test transcript extraction from `<podcast:transcript>` tag. Test OPML nested groups. Test guid fallback logic. Test URL validation integration.
- **T-F03 tests**: Mock `elevenLabsFetch` responses. Test multipart form construction. Test cost calculation. Test budget checking. Test retry logic on failure. Test status lifecycle (pending -> processing -> completed/failed).
- **T-F04 tests**: Mock Supabase queries for feed_episodes and summary_configs. Mock Claude and ElevenLabs calls. Test inactivity detection. Test transcript windowing. Test that episodes row is created with correct `source_type`.

### API Route Tests (Wave 2)

- **T-F05 tests**: Test auth enforcement (401 without token). Test Zod validation (400 on bad input). Test feed creation with valid/invalid URLs. Test OPML import with fixture. Test feed limit enforcement. Test poll rate limiting.
- **T-F06 tests**: Test cron auth (401 without CRON_SECRET). Test summary config CRUD. Test generate-summary ownership check. Test transcription budget enforcement.

### Integration Tests (Wave 4)

- **T-F09**: Full journey test using mocked external services (RSS feeds served from fixtures, mocked ElevenLabs, mocked Claude). Verifies the complete flow from import to playback-ready episode.

### Test Fixtures

All XML fixtures live in `src/lib/rss/__tests__/fixtures/` and are committed to the repo:
- `sample-rss2.xml` — standard RSS 2.0 feed with 5 episodes
- `sample-atom.xml` — Atom feed with 3 episodes
- `sample-opml.xml` — OPML with 10 feeds in 2 groups
- `malformed-feed.xml` — intentionally broken XML (missing closing tags, invalid dates)
- `feed-with-transcript.xml` — RSS 2.0 with `<podcast:transcript>` tags
- `xxe-payload.xml` — XXE attack vector (parser should safely ignore)

---

## Migration Sequence

The migration number `00005` assumes no other migrations are added between now and merge. If another feature merges first with `00005`, rename to `00006` before merging.

Migration is additive-only (new tables + new columns on episodes). No data migration needed. Rollback: drop the 5 new tables and 2 new columns.

---

## Environment Variables Checklist

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PODCAST_INDEX_API_KEY` | No | — | PodcastIndex.org API key (free transcript lookups) |
| `PODCAST_INDEX_API_SECRET` | No | — | PodcastIndex.org API secret |
| `STT_DAILY_LIMIT_MINUTES` | No | `120` | Per-user daily ElevenLabs STT budget |
| `CRON_SECRET` | Yes (for cron) | — | Vercel Cron authentication secret |
| `MAX_FEEDS_PER_USER` | No | `50` | Per-user feed subscription limit |

Existing env vars reused (no changes needed):
- `ELEVENLABS_API_KEY` — already configured for TTS, reused for STT
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — already configured
- `ANTHROPIC_API_KEY` — already configured for Claude
