# PRD: Spotify Podcasts in Feeds + Source Filter

## Introduction

Spotify synced podcasts currently live in a separate `spotify_subscriptions` table and don't appear on the feeds page. Users expect all their podcasts — whether imported via RSS or synced from Spotify — to show up in one unified feeds view. This feature bridges the gap by auto-discovering RSS feeds for Spotify podcasts during sync and adding a source filter so users can slice their feed list by origin.

## Goals

- Spotify synced podcasts appear alongside imported feeds on the feeds page
- Each Spotify podcast auto-discovers its RSS feed URL so episodes get polled like any other feed
- Users can filter feeds by source (All / Spotify / Imported) combined with existing status filters (All / Active / Paused / Error)
- Spotify-originated feeds have full functionality (pause, delete, view episodes, poll) identical to imported feeds
- Source is visually indicated on feed cards (small Spotify/RSS icon badge)

## User Stories

### US-001: Add source column to podcast_feeds table
**Description:** As a developer, I need to track the origin of each feed so the UI can distinguish Spotify-sourced feeds from manually imported ones.

**Acceptance Criteria:**
- [ ] Add `source` column to `podcast_feeds`: `'imported' | 'spotify'` with default `'imported'`
- [ ] Add `spotify_show_id` column (nullable TEXT) to link back to `spotify_subscriptions`
- [ ] Create migration file with appropriate index on `source`
- [ ] Existing feeds retain `source = 'imported'` (default)
- [ ] Update `PodcastFeed` TypeScript type to include `source` and `spotify_show_id`
- [ ] Typecheck passes

### US-002: Auto-discover RSS feed URL during Spotify sync
**Description:** As a user, I want my Spotify podcasts to automatically find their RSS feeds so episodes get polled without manual work.

**Acceptance Criteria:**
- [ ] During `syncSubscriptions()`, for each new Spotify show, attempt to discover its RSS feed URL
- [ ] Discovery strategy: use the podcast's name + publisher to search a podcast directory API (e.g., iTunes Search API `https://itunes.apple.com/search?term={name}&entity=podcast`) or extract from Spotify show metadata
- [ ] If RSS URL found, create entry in `podcast_feeds` with `source = 'spotify'` and `spotify_show_id` set
- [ ] If RSS URL not found, still create the feed entry with `feed_url` set to the Spotify show URL as a fallback (mark with `poll_error` explaining RSS not found)
- [ ] Skip creating feed if a `podcast_feeds` entry already exists for this `spotify_show_id` + `user_id`
- [ ] Populate feed metadata (title, description, image_url) from Spotify show data
- [ ] Typecheck passes

### US-003: Display source badge on feed cards
**Description:** As a user, I want to see at a glance whether a feed came from Spotify or was manually imported.

**Acceptance Criteria:**
- [ ] Feed cards show a small icon badge indicating source (Spotify logo for `spotify`, RSS icon for `imported`)
- [ ] Badge is subtle — doesn't dominate the card layout
- [ ] Badge appears near the feed title or in the card corner
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Add source filter chips to feeds page
**Description:** As a user, I want to filter my feeds by source so I can quickly see just my Spotify podcasts or just my imported feeds.

**Acceptance Criteria:**
- [ ] Add a second row of filter chips: `All Sources` / `Spotify` / `Imported`
- [ ] Source filter works independently of existing status filter (AND logic — both apply)
- [ ] Source filter uses same pill/chip styling as status filters
- [ ] Filter state persists in URL search params (e.g., `?source=spotify&status=active`)
- [ ] Text search applies on top of both filters
- [ ] Empty state message when no feeds match combined filters
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Handle Spotify feed lifecycle
**Description:** As a user, when I remove a podcast from my Spotify library, the corresponding feed should reflect that state.

**Acceptance Criteria:**
- [ ] When `syncSubscriptions()` soft-removes a Spotify subscription (`is_removed = true`), set corresponding `podcast_feeds` entry to `is_active = false`
- [ ] When a Spotify subscription reappears (un-removed), reactivate the feed
- [ ] Deleting a Spotify-sourced feed from the feeds page only deletes the feed — does not affect Spotify subscription
- [ ] Disconnecting Spotify does NOT delete Spotify-sourced feeds (they remain but can't sync)
- [ ] Typecheck passes

### US-006: Update feeds API to include source data
**Description:** As a developer, the feeds API must return source information so the frontend can render badges and filters.

**Acceptance Criteria:**
- [ ] `GET /api/feeds` returns `source` and `spotify_show_id` fields on each feed
- [ ] No changes needed to existing feed CRUD logic (source is set at creation time)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Add `source` (`'imported' | 'spotify'`, default `'imported'`) and `spotify_show_id` (nullable TEXT) columns to `podcast_feeds` table
- FR-2: During Spotify sync, auto-discover RSS feed URLs using iTunes Search API as the primary lookup method
- FR-3: Create `podcast_feeds` entries for each synced Spotify show with `source = 'spotify'`
- FR-4: Display source icon badge (Spotify/RSS) on each feed card
- FR-5: Add source filter chips (All Sources / Spotify / Imported) to feeds page header
- FR-6: Source filter combines with status filter using AND logic
- FR-7: Both filters persist in URL search params
- FR-8: When Spotify subscription is soft-removed, deactivate the corresponding feed
- FR-9: Existing imported feeds are unaffected (default to `source = 'imported'`)

## Non-Goals

- No Spotify-specific playback or Spotify player integration
- No automatic polling of Spotify's proprietary feed format — we rely on discovered RSS feeds
- No manual RSS URL entry for Spotify-sourced feeds
- No migration of existing `spotify_subscriptions` data to a different table — the table remains for sync state
- No changes to the Spotify connect/disconnect flow

## Technical Considerations

- **iTunes Search API** is free, no API key required, rate limited to ~20 req/s. Use `https://itunes.apple.com/search?term={name}&media=podcast&limit=5` and match by title similarity.
- **RSS discovery fallback**: If iTunes doesn't find the podcast, store the Spotify URL as `feed_url` and set `poll_error = 'RSS feed not found — manual URL entry required'` so the user sees it in the error filter.
- **Duplicate prevention**: Use `spotify_show_id` as the dedup key. Before creating a feed, check `podcast_feeds` for existing entry with same `user_id` + `spotify_show_id`.
- **Feed URL uniqueness**: The existing UNIQUE constraint on `(user_id, feed_url)` still applies. If two Spotify shows resolve to the same RSS URL, the second insert should be handled gracefully (update `spotify_show_id` or skip).
- **Migration ordering**: New migration must come after `00006_spotify_integration.sql`.
- **Reuse existing components**: Feed cards, filter chips, search — all exist. Extend, don't rebuild.

## Success Metrics

- All Spotify synced podcasts appear on the feeds page within one sync cycle
- RSS feed discovery succeeds for ≥80% of popular podcasts
- Users can filter to Spotify-only or Imported-only feeds in one click
- No regression in feeds page load time or existing feed functionality

## Open Questions

- Should we show a progress indicator during RSS discovery (since it involves external API calls during sync)?
- If RSS discovery fails, should we offer a manual "Enter RSS URL" option on the feed card?
