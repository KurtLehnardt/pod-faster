# Pod-Faster Architectural Review

**Date:** 2026-03-31
**Reviewer:** Principal Software Architect
**Codebase:** Next.js 16 App Router + Supabase + Claude AI + ElevenLabs TTS

---

## 1. Architecture Overview

**Stack:** Next.js 16.1.6, React 19, Supabase (auth + DB + storage), Anthropic Claude (content generation), ElevenLabs (TTS), Tavily (news search), Zod (validation), Tailwind CSS + shadcn/ui.

**App structure:**
- `(app)/` -- Authenticated app shell (chat, episodes, feeds, settings, topics)
- `(auth)/` -- Login, signup, OAuth callback
- `/try` -- Unauthenticated demo page
- `/listen/[id]` -- Public shareable episode page
- `/api/` -- REST API routes

**Data flow:**
1. User chats to explore topics -> topics extracted via Haiku
2. User configures episode (style, tone, voices, length)
3. Pipeline: Search (Tavily) -> Summarize (Claude) -> Script (Claude) -> Audio (ElevenLabs) -> Upload (Supabase Storage)
4. Polling-based status updates from client

**Server/Client boundaries:** App layout is server component with auth check. All leaf pages under `(app)` are `"use client"`. Landing page is also `"use client"` (unnecessarily -- see Performance section).

---

## 2. Security Audit

### CRITICAL

#### S1. `/api/search` route uses broken authentication
**File:** `/src/app/api/search/route.ts`, line 17
**Severity:** CRITICAL

The search route only checks for the *presence* of an `authorization` header, not its validity:
```typescript
const authHeader = request.headers.get("authorization");
if (!authHeader) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```
Any request with `Authorization: anything` bypasses the check. This exposes the Tavily API to abuse by unauthenticated callers, potentially running up API costs.

**Recommendation:** Replace with `requireAuth()` or validate the Supabase session like other routes.

#### S2. `/api/voices` route has no authentication at all
**File:** `/src/app/api/voices/route.ts`
**Severity:** CRITICAL

The `GET /api/voices` endpoint has zero auth checks. Anyone can enumerate all ElevenLabs voices. While not a data leak per se, it exposes internal API details and could be used to map voice IDs for abuse.

**Recommendation:** Add `requireAuth()` check.

#### S3. `/try` page references non-existent API endpoints
**File:** `/src/app/try/page.tsx`, lines 70-92
**Severity:** CRITICAL

The `/try` page calls `/api/try/generate` (POST) and `/api/try/status` (GET), but these route files do not exist anywhere in the codebase. The feature is completely broken -- clicking "Generate" will produce a 404.

**Recommendation:** Implement `/api/try/generate` and `/api/try/status` routes, or remove the `/try` page. If implementing, add IP-based rate limiting as noted in the TODO comment.

#### S4. `/listen/[id]` page uses wrong storage bucket name
**File:** `/src/app/listen/[id]/page.tsx`, line 32
**Severity:** CRITICAL

The listen page generates signed URLs from the `"audio"` bucket:
```typescript
const { data: signedData } = await supabase.storage
  .from("audio")
  .createSignedUrl(episode.audio_path, 60 * 60);
```
But the actual storage bucket is named `"podcasts"` (see migration `00004_storage.sql` line 8, and `storage-step.ts` line 11). Audio URLs on listen pages will always fail silently, returning `null`.

**Recommendation:** Change `"audio"` to `"podcasts"`.

#### S5. `/listen/[id]` page exposes all completed episodes publicly via admin client
**File:** `/src/app/listen/[id]/page.tsx`, lines 15-24
**Severity:** HIGH

The `getEpisode()` function uses `createAdminClient()` (bypasses RLS) and fetches **any** completed episode by ID -- not just the requesting user's. This is intentional for sharing, but it means episode content (title, topic, script/transcript) is publicly accessible to anyone who knows or guesses a UUID.

There is no `is_public` flag or sharing opt-in mechanism. All completed episodes are automatically public.

**Recommendation:** Add an `is_public` boolean column to episodes (default `false`). Only serve episodes via the listen page when `is_public = true`. Provide a UI toggle to make episodes shareable.

### HIGH

#### S6. Hardcoded admin email for rate limit bypass
**File:** `/src/app/api/episodes/route.ts`, line 165
**Severity:** HIGH

```typescript
const ADMIN_EMAIL = "krlehnardt@gmail.com";
const isAdmin = user.email === ADMIN_EMAIL;
```
Admin check is based solely on email string comparison. If email validation is loose in Supabase auth, someone could register with a similar-looking email. This should use a DB-backed role or Supabase custom claims.

**Recommendation:** Use the `subscription_tier` field or a dedicated `is_admin` column on `profiles`, controlled by the service role only.

#### S7. No rate limiting on most API routes
**File:** Multiple routes (feeds, summary-configs, spotify, chat, etc.)
**Severity:** HIGH

Almost every route has a `// TODO: Add per-user rate limiting` comment. The only rate limiting that exists is:
- 2 episodes/day for non-admin users (episodes POST)
- 15-minute poll interval per feed
- STT daily budget

All other endpoints -- including expensive operations like `/api/chat` (Claude API calls), `/api/generate-summary`, `/api/transcribe` -- have no rate limiting. A malicious authenticated user could run up massive API bills.

**Recommendation:** Implement rate limiting before launch. At minimum, rate-limit `/api/chat`, `/api/generate`, `/api/generate-summary`, and `/api/transcribe`.

#### S8. Missing `/feeds` in middleware protected prefixes
**File:** `/src/lib/supabase/middleware.ts`, line 40
**Severity:** MEDIUM

The middleware protects `/chat`, `/episodes`, `/settings`, `/topics` but not `/feeds`. The `(app)/layout.tsx` server component does check auth and redirects, so this is defense-in-depth rather than a direct vulnerability. However, it means unauthenticated requests to `/feeds` still render the server component before redirecting, adding unnecessary load.

**Recommendation:** Add `/feeds` to `protectedPrefixes`.

#### S9. Spotify PKCE cookie path allows reading from any `/api/spotify/*` route
**File:** `/src/app/api/spotify/connect/route.ts`, line 77
**Severity:** LOW

The PKCE cookie path is `/api/spotify`, meaning all Spotify API routes can read it. This is wider than necessary -- only `/api/spotify/callback` needs it.

**Recommendation:** Set `path: "/api/spotify/callback"`.

#### S10. No CSRF protection on state-changing POST/PUT/DELETE routes
**Severity:** MEDIUM

Next.js API routes don't have built-in CSRF protection. All mutating endpoints accept JSON bodies with cookie-based auth. While the `Content-Type: application/json` requirement provides some CSRF mitigation (browsers don't send JSON in simple cross-origin form submissions), this is not bulletproof.

**Recommendation:** Consider adding `Origin` / `Referer` header validation or CSRF tokens for state-changing routes.

#### S11. `topic_query` in chat messages and episodes is not length-bounded
**File:** `/src/app/api/chat/route.ts`, `/src/app/api/episodes/route.ts`
**Severity:** MEDIUM

The chat `message` field and episode `topicQuery` have no maximum length validation. A user could send megabytes of text, which would be forwarded to Claude (billing cost) and stored in the DB.

**Recommendation:** Add `maxLength` validation (e.g., 2000 chars for messages, 500 chars for topic queries).

---

## 3. Data Layer

### Schema Design

**Overall:** Well-designed relational schema with proper foreign keys, cascading deletes, CHECK constraints, and appropriate use of UUID primary keys.

#### D1. `chat_messages` table grows unbounded
**File:** `supabase/migrations/00001_initial_schema.sql`
**Severity:** MEDIUM

No retention policy or limits on `chat_messages`. Heavy users could accumulate thousands of messages. There is no pagination on chat history loading, and the entire history is sent to Claude on each message.

**Recommendation:** Implement message pruning (e.g., keep last 50 messages per user) or archive old messages. Add a `LIMIT` to history sent to Claude.

#### D2. Episodes store full script JSON and summary text with no size constraint
**File:** `supabase/migrations/00001_initial_schema.sql`
**Severity:** LOW

The `script` (JSONB) and `summary` (TEXT) columns on `episodes` have no size limits. `feed_episodes.transcript` correctly has a 512 KB constraint.

**Recommendation:** Add `CHECK (octet_length(summary) <= 524288)` and similar for `script`.

#### D3. Non-atomic feed link update in summary config PUT
**File:** `/src/app/api/summary-configs/[id]/route.ts`, lines 166-201
**Severity:** MEDIUM

The PUT handler deletes all existing `summary_config_feeds` rows, then inserts new ones. If the insert fails after the delete, the config is left with zero feed links. The code logs this as "CRITICAL" but doesn't recover.

**Recommendation:** Wrap in a Supabase RPC function that uses a transaction, or use a compare-and-swap approach.

### Row Level Security

**Overall:** Excellent RLS coverage. All tables have RLS enabled with per-user policies. Key observations:

- `spotify_tokens` has a service_role `FOR ALL` policy, which is correct since tokens are managed server-side
- `summary_generation_log` is SELECT-only for users, write via admin client -- correct
- `summary_config_feeds` uses correlated subqueries for RLS with a supporting index (`idx_summary_configs_id_user`) -- good performance consideration
- Subscription tier guard trigger prevents users from self-promoting -- well done

### Query Patterns

#### D4. N+1 potential in feed polling
**File:** `/src/app/api/feeds/poll/route.ts`, lines 131-335
**Severity:** MEDIUM

The poll route iterates over feeds sequentially. For each feed it:
1. Queries existing episode GUIDs
2. Polls the RSS feed
3. Extracts transcripts (sequential loop with HTTP calls)
4. Upserts episodes
5. Queries null-duration episodes
6. Updates each episode duration individually in a loop (lines 251-263)

The duration backfill loop issues individual UPDATE statements per episode (capped at 50).

**Recommendation:** Batch the duration backfill into a single RPC or use `CASE` in a single UPDATE.

#### D5. Sequential transcript extraction during feed creation
**File:** `/src/app/api/feeds/route.ts`, lines 207-237
**Severity:** MEDIUM

When creating a feed, transcripts are extracted sequentially for each episode (`for...of` loop with `await`). If a feed has 50 episodes with transcript URLs, this could take minutes.

**Recommendation:** Parallelize with `Promise.allSettled` (with concurrency limit) or move to background processing.

### Indexes

**Overall:** Good index coverage. Notable indexes: composite indexes for RLS acceleration, partial indexes for active feed polling, STT budget check index. No obvious missing indexes for the current query patterns.

---

## 4. API Design

### HIGH

#### A1. Inconsistent auth patterns across routes
**Severity:** HIGH

Three different auth patterns are used:
1. `requireAuth()` helper (feeds, summary-configs, transcribe) -- cleanest
2. Inline `supabase.auth.getUser()` check (episodes, chat, spotify routes) -- duplicated
3. Header presence check only (search) -- broken

**Recommendation:** Migrate all routes to use `requireAuth()` for consistency and correctness.

#### A2. No PATCH for episodes
**Severity:** LOW

Episodes support GET and DELETE but not PATCH/PUT. Users cannot update episode metadata (e.g., rename an episode title).

### MEDIUM

#### A3. Inconsistent error response shapes
**Severity:** MEDIUM

Most routes return `{ error: string }`, but some include `details` (Zod validation errors), `budget` (transcribe), or `requiredTier`/`currentTier` (feature gate). No standardized error envelope.

**Recommendation:** Define a standard error response type: `{ error: string, code?: string, details?: unknown }`.

#### A4. DELETE summary config doesn't verify deletion happened
**File:** `/src/app/api/summary-configs/[id]/route.ts`, line 230-234
**Severity:** LOW

The delete operation doesn't check if any row was actually deleted. If the ID doesn't exist or belongs to another user, it returns `{ deleted: true }` anyway (RLS silently filters).

---

## 5. Performance

### HIGH

#### P1. Landing page is unnecessarily a client component
**File:** `/src/app/page.tsx`, line 1
**Severity:** HIGH

The landing page is marked `"use client"` but contains no interactive state, effects, or event handlers (it's all static markup with Links). This forces the entire page to be hydrated client-side, increasing bundle size and TTI.

**Recommendation:** Remove `"use client"` directive. The landing page can be a pure server component.

#### P2. No caching on voices endpoint
**File:** `/src/app/api/voices/route.ts`
**Severity:** MEDIUM

The voices list is fetched from ElevenLabs on every request. Voice lists change rarely.

**Recommendation:** Add `Cache-Control` headers (e.g., `max-age=3600`) or use Next.js `revalidate`.

#### P3. Full conversation history sent to Claude on every chat message
**File:** `/src/app/api/chat/route.ts`, lines 63-71
**Severity:** MEDIUM

The entire message history is sent to Claude on each turn, with no truncation or summarization. Long conversations will hit token limits and increase costs/latency.

**Recommendation:** Implement sliding window (last N messages) or summarize older messages.

#### P4. Sitemap fetches up to 500 episodes from DB on every request
**File:** `/src/app/sitemap.ts`
**Severity:** LOW

The sitemap queries the DB on every request via admin client with no caching. For a sitemap that search engines typically fetch once per day, this is wasteful.

**Recommendation:** Add `revalidate` export or generate the sitemap at build time.

### MEDIUM

#### P5. Episodes page fetches up to 100 episodes client-side without pagination
**File:** `/src/app/(app)/episodes/page.tsx`, line 64
**Severity:** MEDIUM

The episodes list page fetches 100 episodes in a single client-side query. The API supports pagination, but the page doesn't use it.

**Recommendation:** Implement infinite scroll or pagination in the UI.

---

## 6. Code Quality

### HIGH

#### C1. Inconsistent Supabase client usage in Spotify routes
**Severity:** MEDIUM

Spotify routes (connect, callback, status, disconnect, sync, subscriptions) all use inline `createClient()` + `supabase.auth.getUser()` instead of `requireAuth()`. This is duplicated across 8+ files.

**Recommendation:** Migrate to `requireAuth()` helper.

### MEDIUM

#### C2. `eslint-disable` for RPC type
**File:** `/src/app/api/feeds/route.ts`, line 58
**Severity:** LOW

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { data: countData, error: countError } = await (supabase.rpc as any)(
```
The `feed_episode_counts` RPC is not in the generated Database types.

**Recommendation:** Update `database.types.ts` to include the RPC function signature.

#### C3. Multiple type assertion patterns
**Severity:** LOW

Inconsistent patterns for handling Supabase query results:
- `as unknown as SummaryConfig` (common)
- `as PodcastFeedRow` (some places)
- `as unknown as Json` (voice config)

This is partly due to the hand-maintained `database.types.ts`. Consider auto-generating types from Supabase.

#### C4. Dead/unused code
**Severity:** LOW

- `src/app/(app)/topics/page.tsx` exists but topics feature appears to be only partially implemented (extracted from chat, no CRUD UI for topics beyond chips)
- `strip-html.ts` utility -- need to verify if it's used anywhere

#### C5. No input sanitization for HTML in user-provided text
**Severity:** MEDIUM

User-provided text (topic queries, feed titles, chat messages) is rendered in React components which auto-escapes HTML. However, episode scripts and summaries generated by Claude are stored as text/JSON and rendered with `{seg.text}` in `listen-client.tsx`. React's JSX auto-escaping handles this, but if any rendering path uses `dangerouslySetInnerHTML` for these fields in the future, it would be an XSS vector.

The `dangerouslySetInnerHTML` usage in `layout.tsx` (lines 91-99) is safe since it only renders static JSON-LD data defined in code, not user input.

### LOW

#### C6. Singleton pattern for API clients may cause issues in edge runtime
**File:** `/src/lib/ai/anthropic.ts`, `/src/lib/elevenlabs/client.ts`
**Severity:** LOW

Module-level singleton variables (`let client`, `let cachedApiKey`) work in Node.js serverless but may not behave as expected in edge runtimes where modules are re-instantiated.

---

## 7. Infrastructure & DevOps

### HIGH

#### I1. No environment variable validation at startup
**Severity:** HIGH

Environment variables are checked lazily when first accessed. Missing required env vars (ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, etc.) will cause runtime errors on first request rather than failing at deploy time.

**Recommendation:** Add a startup validation step (e.g., in `next.config.ts` or a root layout precheck) that validates all required env vars are present.

#### I2. No structured logging
**Severity:** MEDIUM

All logging uses `console.log`/`console.error` with string interpolation. No structured fields, no log levels, no correlation IDs.

**Recommendation:** Adopt a structured logging library (e.g., `pino`) with request-scoped correlation IDs.

#### I3. No error monitoring integration
**Severity:** MEDIUM

No Sentry, Datadog, or similar error tracking. Errors are logged to console and may be lost in serverless environments.

**Recommendation:** Integrate an error monitoring service before launch.

### MEDIUM

#### I4. CI pipeline doesn't run lint
**File:** `.github/workflows/ci.yml`
**Severity:** LOW

The CI runs `tsc --noEmit`, `pnpm test`, and `pnpm build`, but doesn't run `pnpm lint`. ESLint errors could slip through.

**Recommendation:** Add `pnpm lint` to CI.

#### I5. No `NEXT_PUBLIC_SITE_URL` in `.env.example`
**File:** `.env.example`
**Severity:** LOW

The `NEXT_PUBLIC_SITE_URL` env var is used in `layout.tsx` for metadata and in `robots.txt`/`sitemap.ts`, but it's not listed in `.env.example`. `NEXT_PUBLIC_APP_URL` is listed but serves a different purpose (email redirects).

**Recommendation:** Add `NEXT_PUBLIC_SITE_URL` to `.env.example`.

---

## 8. Product/UX Gaps

### CRITICAL

#### U1. `/try` page is completely broken
**File:** `/src/app/try/page.tsx`
**Severity:** CRITICAL

The Try page -- which is the primary conversion funnel ("Free to try -- no account needed") -- calls API endpoints (`/api/try/generate`, `/api/try/status`) that don't exist. Users clicking "Generate Podcast" will see a "Failed to start generation" error.

**Recommendation:** Implement the try API endpoints or temporarily remove/disable the try page.

### HIGH

#### U2. No password reset flow
**Severity:** HIGH

There is no "Forgot password?" link on the login page and no password reset page. Users who forget their password are locked out.

**Recommendation:** Add Supabase password reset flow (`supabase.auth.resetPasswordForEmail`).

#### U3. No loading states for long-running operations
**Severity:** MEDIUM

Episode generation (`/api/generate`) runs synchronously for up to 300 seconds. While the client polls for status, there's no real-time progress feedback beyond status text. If the Vercel function times out, the episode is left in an intermediate state with no recovery mechanism.

**Recommendation:** Add a retry button for stuck episodes. Consider showing elapsed time during generation.

#### U4. No email verification enforcement
**Severity:** MEDIUM

The signup flow handles both auto-confirm and email confirmation paths, but there's no indication in the settings whether the email is verified. If email confirmation is enabled in Supabase, users could have unverified emails.

### MEDIUM

#### U5. Listen page audio player has no error state
**File:** `/src/app/listen/[id]/listen-client.tsx`
**Severity:** MEDIUM

If `audioUrl` is null (which it always is due to the wrong bucket name in S4), the audio player section simply doesn't render. There's no error message or fallback.

**Recommendation:** Show "Audio unavailable" message when `audioUrl` is null for a completed episode.

#### U6. No dark/light mode toggle
**Severity:** LOW

The app is hardcoded to dark mode (`<html lang="en" className="dark">` in root layout). `next-themes` is installed as a dependency but not used.

**Recommendation:** Add theme toggle using `next-themes` since it's already a dependency.

#### U7. Chat history not persisted across page reloads
**Severity:** MEDIUM

Messages are saved to the DB (`chat_messages` table) but the `useChat` hook initializes with an empty array. Chat history is lost on page reload. There's no mechanism to load previous messages.

**Recommendation:** Fetch recent chat history on mount from the `chat_messages` table.

---

## Summary by Severity

| Severity | Count | Key Items |
|----------|-------|-----------|
| CRITICAL | 4 | Broken /try page (S3/U1), wrong storage bucket in listen page (S4), broken search auth (S1), missing try API routes |
| HIGH | 8 | No rate limiting (S7), public episode exposure (S5), hardcoded admin (S6), no password reset (U2), landing page perf (P1), no env validation (I1) |
| MEDIUM | 14 | CSRF gaps (S10), unbounded input (S11), N+1 queries (D4), non-atomic updates (D3), missing /feeds in middleware (S8), chat history not loaded (U7), no structured logging (I2), no error monitoring (I3) |
| LOW | 10 | Various code quality, missing lint in CI, minor UX polish |

### Top 5 Actions Before Launch

1. **Fix the `/try` page** -- Either implement `/api/try/generate` and `/api/try/status` or remove the page. This is the primary acquisition funnel.
2. **Fix the listen page storage bucket** -- Change `"audio"` to `"podcasts"` in `/src/app/listen/[id]/page.tsx`.
3. **Fix `/api/search` authentication** -- Replace header presence check with `requireAuth()`.
4. **Add rate limiting to expensive routes** -- At minimum: `/api/chat`, `/api/generate`, `/api/generate-summary`.
5. **Add environment variable validation** -- Fail fast at deploy time rather than on first request.
