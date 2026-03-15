# Pod-Faster: Technical & Business Roadmap

## Executive Summary

Pod-Faster is an AI-powered podcast generation platform that transforms any news topic into a multi-voice audio episode in minutes. The core pipeline -- search, summarize, script, audio, upload -- is fully implemented and architecturally sound. The stack (Next.js 16, React 19, Supabase, Claude, ElevenLabs, Tailwind/shadcn) is modern and well-suited to the problem. TypeScript strict mode passes cleanly. RLS is properly configured on every table. The codebase is well-organized with clear separation between pipeline steps, API routes, and UI components.

However, the product is pre-revenue and pre-launch. There is no rate limiting on any endpoint, no structured logging or monitoring, no error alerting, no cost controls on API spend, and no payment integration. The chat interface exists but is disconnected from episode creation -- the "Chat" page shows a "Quick Generate" button that opens a config dialog, but the actual `ChatInterface` component (defined in `src/components/chat/chat-interface.tsx`) is imported nowhere -- no page renders it. The landing page exists but has no analytics. The application works but cannot safely be exposed to public traffic.

The path from here to a viable product requires three parallel tracks: hardening the infrastructure for production safety, completing the user experience gaps that block retention, and building the monetization layer that makes the business sustainable. This roadmap sequences those tracks with the goal of reaching first revenue within 12 weeks and sustainable unit economics within 24 weeks.

---

## Current State Assessment

### Strengths

1. **Clean architecture.** The 5-step pipeline (search -> summarize -> script -> audio -> upload) is well-decomposed. Each step is independently testable and has its own module. The orchestrator handles status updates and error propagation correctly.

2. **Strong type safety.** TypeScript strict mode is enforced. Database types are manually defined and match the SQL schema. All API routes validate input before processing. JSON parsing from Claude includes defensive type checking.

3. **Proper auth and RLS.** Supabase auth with cookie-based sessions via middleware. RLS policies on every table enforce user_id scoping. Storage bucket has RLS policies matching userId folder paths. Admin client is used only where needed (pipeline, audio URL signing).

4. **Good test coverage for core logic.** 18 test files covering the AI client, prompts, search, ElevenLabs, pipeline steps, and the audio player hook. Pipeline orchestrator tests are thorough with happy path, error handling, and sequential execution verification.

5. **Modern frontend.** App shell with responsive sidebar, mobile sheet, persistent player bar. shadcn/ui components. Dark mode by default. Episode detail page with script viewer that syncs highlighting to playback position.

6. **Resilient external API integration.** ElevenLabs client has exponential backoff with jitter on 429s. Dialogue module falls back from dialogue API to sequential TTS concatenation. Tavily search uses Promise.allSettled for parallel queries with graceful degradation.

7. **Cost tracking built in.** Episodes track `claude_tokens_used` and `elevenlabs_characters_used` from the start, enabling future cost analysis without schema changes.

### Weaknesses

1. **No rate limiting.** Any authenticated user can hammer the generation endpoint indefinitely, burning API credits. The search route only checks for the presence of an authorization header -- it does not validate it. This is a critical gap before any public deployment.

2. **No monitoring or logging.** All errors go to `console.error`. No structured logging. No correlation IDs. No health check endpoint. No alerting. A pipeline failure silently sets `status = 'failed'` in the database, but no one is notified.

3. **Chat interface is orphaned.** The `ChatInterface`, `MessageBubble`, `TopicChips`, and `VoiceInputButton` components exist but are never rendered. The `useChat` and `useVoiceInput` hooks are implemented but unused. The Chat page only shows an episode config dialog. This means the core differentiating UX -- conversational topic exploration -- is not functional.

4. **Fire-and-forget pipeline execution.** The generate route calls `runPipeline` as a detached promise. On Vercel, `waitUntil` is accessed via `globalThis.__nextWaitUntil` which is an undocumented internal. In local dev, a rejected promise with no `.catch` would crash. The `.catch` exists but only logs -- no retry, no notification. Long episodes (30 min) may exceed Vercel function timeout (default 10s, max 300s on Pro).

5. **No input sanitization on prompts.** User-provided topic queries are passed directly into Claude prompts without sanitization. While Claude has built-in safety, prompt injection via malicious topic queries is a risk.

6. **No cost controls.** A user requesting 30-minute episodes repeatedly could burn hundreds of dollars in API costs. There are no per-user limits, no spending caps, no usage quotas.

7. **Episode status polling is wasteful.** The `useEpisodeStatus` hook polls every 2 seconds via HTTP. For a multi-minute pipeline, this means 60+ redundant API calls per episode generation. WebSocket or Supabase Realtime subscriptions would be far more efficient.

8. **No audio duration tracking.** The `audio_duration_seconds` column is never populated -- it stays null. The UI falls back to displaying "~5 min" but this is inaccurate for generated content.

9. **Incomplete onboarding funnel.** The root `/` page is a well-designed marketing landing page with features, how-it-works, and CTA sections linking to `/signup`. However, unauthenticated users hitting `/chat` directly get redirected to `/login` with no explanation of what the product does. After signup, users land on an empty chat page with only a "Quick Generate" button and no guidance. The post-signup first-run experience is the critical gap.

10. **Duplicate code.** `concatArrayBuffers` is defined identically in both `audio-step.ts` and `dialogue.ts`. `STATUS_LABELS` and `STATUS_VARIANTS` maps are duplicated between `episode-card.tsx` and the episode detail page (`episodes/[id]/page.tsx`), and the label strings are inconsistent between them (e.g., "Searching" vs "Searching sources", "Writing Script" vs "Writing script").

### Opportunities

1. **Conversational podcast creation is a blue ocean.** Most AI podcast tools are form-based. A chat-first UX where you explore topics, get suggestions, and configure episodes through conversation is genuinely differentiated.

2. **Personalized daily briefings.** Users define topics; the system generates a daily podcast automatically. This creates habitual engagement and high retention. The `topics` table and `is_active` flag already support this.

3. **Multi-language expansion.** ElevenLabs supports 29 languages. Claude supports all major languages. The pipeline architecture supports this with minimal changes (add language to episode config, pass to prompts).

4. **RSS feed generation.** Each user gets a private RSS feed. They add it to Apple Podcasts, Spotify, etc. Content shows up in their existing podcast app. This eliminates the need to build a full-featured audio player and leverages existing distribution.

5. **Team/workspace model.** Shared topics, shared episodes, collaborative podcast creation. Natural expansion from individual to B2B.

### Threats

1. **AI cost volatility.** Claude and ElevenLabs pricing could change. A 5-minute episode uses roughly 6K-8K Claude tokens (~$0.06 at Sonnet rates) and ~5,000 ElevenLabs characters (~$0.90-1.50 depending on plan tier). A 30-minute episode would use ~30K ElevenLabs characters (~$5.40-9.00). ElevenLabs dominates cost at 90%+. If ElevenLabs raises prices 2x, unit economics break without price increases to users or a renegotiated enterprise deal.

2. **Platform risk on ElevenLabs.** The dialogue API (`/text-to-dialogue`) is used for multi-voice episodes but may not be a stable endpoint. The fallback to sequential TTS exists, but produces lower quality output. If ElevenLabs deprecates or rate-limits heavily, the core product degrades.

3. **Competition from incumbents.** Google NotebookLM already generates podcast-style audio from source material. Spotify may add AI podcast features. These companies have distribution advantages that Pod-Faster cannot match head-on.

4. **Vercel serverless limits.** The pipeline runs as a single long-running function. Vercel's Hobby tier has a 10-second timeout, Pro has 300 seconds (5 minutes). A 5-minute episode with 10 script segments making sequential TTS calls takes roughly 60-120 seconds. A 30-minute episode with 60+ segments could take 5-10+ minutes, exceeding even the Pro timeout. The current `waitUntil` approach (`globalThis.__nextWaitUntil`) is undocumented and may break across Next.js versions. Moving to a proper queue (Inngest, QStash, or a background worker) is a prerequisite for episodes longer than ~5 minutes.

---

## Phase 1: Foundation Hardening (Weeks 1-4)

Goal: Make the application safe to deploy to public traffic. Eliminate the risks that could cause financial loss or data exposure.

### 1.1 Rate Limiting on All API Routes
- **What:** Add per-user rate limiting to `/api/chat`, `/api/generate`, `/api/episodes`, `/api/search`, `/api/voices`. Use in-memory rate limiter (e.g., `@upstash/ratelimit` with Redis, or simple in-process token bucket for MVP).
- **Why:** Without this, a single user or bot can burn unlimited API credits. The `/api/search` route is especially vulnerable -- it only checks for the presence of an `authorization` header, not validity.
- **Effort:** M (3-5 days)
- **Priority:** P0 -- Critical blocker for launch
- **Owner:** Backend engineer

### 1.2 Fix Search Route Authentication
- **What:** Replace the `authorization` header presence check with proper Supabase auth validation in `/api/search/route.ts`. It should use `createClient()` and `getUser()` like every other protected route.
- **Why:** Currently any request with any `authorization` header value gets access. This is a security hole.
- **Effort:** S (1 hour)
- **Priority:** P0 -- Security vulnerability
- **Owner:** Backend engineer

### 1.3 Structured Logging and Error Alerting
- **What:** Add Pino logger with JSON output. Add correlation IDs to pipeline runs. Add health check endpoint (`/api/health`). Integrate with Vercel's log drain or a service like Axiom/Datadog.
- **Why:** `console.error` is invisible in production. Pipeline failures are silent. Need to detect and respond to incidents.
- **Effort:** M (3-4 days)
- **Priority:** P0
- **Owner:** Backend/DevOps engineer

### 1.4 API Cost Controls
- **What:** Add per-user daily generation limits (e.g., 5 episodes/day on free tier). Track API cost estimates per episode using the already-captured token/character counts. Add a circuit breaker that pauses generation if cumulative daily spend exceeds a configurable threshold.
- **Why:** Unbounded API spend is the primary financial risk.
- **Effort:** M (3-4 days)
- **Priority:** P0
- **Owner:** Backend engineer

### 1.5 Input Sanitization for Prompts
- **What:** Add input sanitization to topic queries before they reach Claude prompts. Strip control characters, limit length to 500 characters, add a lightweight content filter for obviously abusive inputs.
- **Why:** Prompt injection defense-in-depth. Claude has guardrails but relying solely on them is insufficient.
- **Effort:** S (1-2 days)
- **Priority:** P1
- **Owner:** Backend engineer

### 1.6 Pipeline Execution Hardening
- **What:** (a) Add per-step timeouts to the pipeline orchestrator. (b) Add retry logic with exponential backoff for transient failures (Claude 429, network errors). (c) Investigate Vercel `waitUntil` stability or migrate to an async job queue (Inngest, QStash). (d) Add `audio_duration_seconds` population after audio generation.
- **Why:** The fire-and-forget model with no timeout and no retry is fragile. Long episodes will fail silently on Vercel's default timeout.
- **Effort:** L (5-7 days)
- **Priority:** P1
- **Owner:** Backend engineer

### 1.7 Replace Polling with Realtime
- **What:** Replace `useEpisodeStatus` HTTP polling with Supabase Realtime subscriptions on the episodes table. Subscribe to changes for the specific episode ID, update state on `UPDATE` events, unsubscribe on terminal status.
- **Why:** Eliminates 60+ unnecessary API calls per generation. Reduces server load. Improves UX with instant status updates.
- **Effort:** S (2 days)
- **Priority:** P2
- **Owner:** Frontend engineer

### 1.8 Error Monitoring (Sentry or Equivalent)
- **What:** Integrate Sentry (or Axiom/Highlight.io) for runtime error tracking. Add source maps for production stack traces. Configure alert rules for error rate spikes (>5% over 5 minutes) and pipeline failure rate increases. Add Sentry to the Next.js error boundary.
- **Why:** Structured logging (1.3) captures what happened. Error monitoring detects patterns, deduplicates errors, and alerts on regressions. These are complementary, not redundant. Without automated alerting, incidents are only discovered when users complain.
- **Effort:** S (1-2 days)
- **Priority:** P1
- **Owner:** Backend engineer

### 1.9 CI/CD Hardening
- **What:** Add ESLint to CI pipeline (currently only `tsc` and `vitest`). Add Playwright E2E test skeleton. Add environment variable validation at build time. Add branch protection rules.
- **Why:** ESLint is configured but not run in CI. No E2E tests exist. Environment variable misconfiguration is a common deployment failure mode.
- **Effort:** S (2 days)
- **Priority:** P2
- **Owner:** DevOps engineer

### 1.10 Code Deduplication
- **What:** Extract `concatArrayBuffers` to a shared utility in `src/lib/utils/`. Extract `STATUS_LABELS` and `STATUS_VARIANTS` to `src/lib/constants/episode-status.ts` -- note that the two current copies have inconsistent labels (e.g., `episode-card.tsx` says "Searching" while `episodes/[id]/page.tsx` says "Searching sources"). Reconcile during extraction. Remove unused imports and dead code.
- **Why:** Reduces maintenance burden and eliminates the risk of divergent behavior -- the inconsistent status labels are already a UX bug.
- **Effort:** S (1 day)
- **Priority:** P3
- **Owner:** Any engineer

---

## Phase 2: Product-Market Fit (Weeks 5-12)

Goal: Complete the core user experience. Wire up the conversational flow. Add features that drive engagement and retention.

### 2.1 Wire Up the Chat Interface
- **What:** Integrate the existing `ChatInterface`, `MessageBubble`, `TopicChips`, and `VoiceInputButton` components into the Chat page. Connect `useChat` hook to the actual UX. Add a "Generate from this topic" button that pre-fills the episode config dialog with the extracted topic and suggested query.
- **Why:** The chat-first UX is the primary differentiator. Currently it is built but disconnected. Users land on a page that says "Start a conversation" but there is no conversation interface.
- **Effort:** M (3-4 days)
- **Priority:** P0 -- Core product gap
- **Owner:** Frontend engineer

### 2.2 Automated Daily Briefings
- **What:** Add a scheduled job (Vercel Cron or Inngest) that runs daily. For each user with active topics, generate a single episode that covers all their active topics. Store as a regular episode. Send an optional push notification or email.
- **Why:** This is the killer retention feature. Users wake up to a fresh personalized podcast every morning. Creates habitual engagement without requiring manual action.
- **Effort:** L (5-7 days)
- **Priority:** P0
- **Owner:** Backend engineer

### 2.3 RSS Feed per User
- **What:** Generate a private RSS feed at `/api/feed/[userId]/rss.xml` that lists completed episodes with signed audio URLs. Users add this to their preferred podcast app.
- **Why:** Eliminates friction. Users do not need to visit the web app to listen. Leverages existing distribution (Apple Podcasts, Spotify, Pocket Casts). Dramatically increases engagement.
- **Effort:** M (3-4 days)
- **Priority:** P1
- **Owner:** Backend engineer

### 2.4 Episode Regeneration and Editing
- **What:** Allow users to regenerate a failed episode, retry from a specific step, or edit the script before audio generation. Add "Regenerate" button on episode detail. Add script editing UI with re-generate-audio-only option.
- **Why:** Generation failures are common (API timeouts, bad content). Users need recovery paths. Script editing gives users control and increases perceived quality.
- **Effort:** M (4-5 days)
- **Priority:** P1
- **Owner:** Full stack engineer

### 2.5 Onboarding Flow
- **What:** After signup, guide users through: (1) pick 3 topics, (2) choose a default style/voice, (3) generate their first episode. Show a tutorial-style progress indicator. Pre-select sensible defaults.
- **Why:** Current signup lands users on an empty chat page with no guidance. First-time user experience determines retention.
- **Effort:** M (3-4 days)
- **Priority:** P1
- **Owner:** Frontend engineer

### 2.6 Episode Sharing
- **What:** Add a "Share" button that generates a public, time-limited URL for a specific episode. Public page shows episode metadata, script preview, and embedded audio player. No auth required.
- **Why:** Organic growth through sharing. Users who create something want to share it.
- **Effort:** M (3-4 days)
- **Priority:** P2
- **Owner:** Full stack engineer

### 2.7 Analytics Events
- **What:** Add client-side event tracking (Posthog, Mixpanel, or Plausible). Track: signup, first episode created, episode completed, episode played, episode shared, daily active use, topics added.
- **Why:** Cannot improve what you do not measure. Essential for validating PMF hypotheses.
- **Effort:** S (2 days)
- **Priority:** P1
- **Owner:** Frontend engineer

### 2.8 Legal Pages and Privacy Compliance
- **What:** Add Terms of Service, Privacy Policy, and Cookie Policy pages. Implement GDPR-compliant data export (user can download all their data as JSON/ZIP). Implement account deletion that cascades to all user data (episodes, topics, chat history, audio files in Supabase Storage). Add cookie consent banner if analytics are added (2.7). Add a data retention policy document.
- **Why:** Legal requirement for any public-facing product that collects user data. GDPR/CCPA compliance is not optional. Lack of a privacy policy blocks B2B adoption and app store listings.
- **Effort:** M (3-4 days for implementation, plus legal review)
- **Priority:** P1 -- Legal blocker for public launch
- **Owner:** Full stack engineer + legal counsel

### 2.9 Accessibility Audit and Fixes
- **What:** Run axe-core audit on all pages. Fix ARIA labels, keyboard navigation, focus management, color contrast issues. Ensure the audio player is fully keyboard-accessible. Add skip-to-content links. Test with screen readers (VoiceOver, NVDA).
- **Why:** Accessibility is both a legal requirement (ADA, EU Accessibility Act) and a quality signal. The current UI uses proper semantic HTML via shadcn/ui, but custom components (script viewer, episode cards, audio player) likely have gaps.
- **Effort:** M (3-4 days)
- **Priority:** P2
- **Owner:** Frontend engineer

### 2.10 Mobile-Optimized Audio Experience
- **What:** Add background audio playback support. Add Media Session API integration for lock screen controls. Persist playback position across sessions (partially done via `localStorage` in the `useAudioPlayer` hook). Add download-for-offline option. Test on iOS Safari and Chrome Mobile for audio playback reliability.
- **Why:** Podcasts are consumed on mobile, often while doing other things. Background playback is table stakes for a podcast product.
- **Effort:** M (3-4 days)
- **Priority:** P2
- **Owner:** Frontend engineer

---

## Phase 3: Monetization & Scale (Weeks 13-24)

Goal: Achieve first revenue. Build infrastructure to support growing user base. Establish sustainable unit economics.

> **Sequencing note:** Queue-based pipeline (3.3) is listed after Stripe (3.1) for logical grouping, but should be started in parallel with or before Stripe integration. The Vercel timeout risk is high-probability and high-impact -- any episode longer than ~3-5 minutes is at risk of failing on Pro plan (300s timeout), and all episodes fail on free tier (10s timeout). This is a P0 infrastructure prerequisite for monetization.

### 3.1 Stripe Payment Integration
- **What:** Integrate Stripe for subscription billing. Define tiers: Free (3 episodes/month, 5-min max), Pro ($9.99/month, 30 episodes/month, 30-min max, daily briefings), Team ($29.99/month, unlimited, shared topics, priority generation).
- **Why:** This is the revenue engine. Free tier acquires users, Pro converts engaged users, Team captures B2B.
- **Effort:** L (7-10 days)
- **Priority:** P0
- **Owner:** Full stack engineer

### 3.2 Usage Metering and Billing Dashboard
- **What:** Track episodes generated, tokens consumed, characters used per billing period. Show usage dashboard in settings. Send warnings at 80% and 100% of quota. Enforce hard limits.
- **Why:** Users need transparency on usage. Hard limits prevent cost overruns.
- **Effort:** M (4-5 days)
- **Priority:** P0
- **Owner:** Full stack engineer

### 3.3 Queue-Based Pipeline Execution
- **What:** Migrate from fire-and-forget `runPipeline` to a proper job queue (Inngest recommended for Vercel). Each pipeline step becomes a separate queue step with independent retries, timeouts, and observability. Add dead letter queue for permanently failed jobs.
- **Why:** Current approach does not scale. Sequential TTS calls for a 30-minute episode could take 5+ minutes, exceeding Vercel function timeout. Queue-based execution enables retry, monitoring, and horizontal scaling.
- **Effort:** L (7-10 days)
- **Priority:** P0
- **Owner:** Backend engineer

### 3.4 Model Cost Optimization
- **What:** (a) Use Haiku 4.5 instead of Sonnet 4 for summarization (it is a synthesis task, not creative generation -- Haiku 4.5 at $1/$5 per MTok is 3x cheaper than Sonnet 4 at $3/$15 per MTok). (b) Cache search results for identical queries within a 1-hour window. (c) Evaluate ElevenLabs model options -- the current default `eleven_v3` may not be the cheapest; newer Flash/Turbo models may offer lower per-character costs. (d) Estimate cost before generation and show it to the user. (e) Use Anthropic prompt caching (up to 90% discount on cached input tokens) for repeated system prompts.
- **Why:** Reduces Claude COGS by ~50%. Claude costs are small relative to ElevenLabs, but prompt caching and model downgrades are zero-effort wins. Search caching eliminates redundant Tavily calls. The real savings come from ElevenLabs plan optimization (see ADR-1).
- **Effort:** M (3-4 days)
- **Priority:** P1
- **Owner:** Backend engineer

### 3.5 CDN-Backed Audio Delivery
- **What:** After upload to Supabase Storage, generate a CDN-backed URL (Cloudflare R2 or Vercel Blob) for completed episodes. Serve audio from CDN instead of generating signed URLs per request.
- **Why:** Signed URLs add latency. CDN improves playback start time and supports global distribution. Reduces Supabase Storage egress costs.
- **Effort:** M (3-4 days)
- **Priority:** P2
- **Owner:** Backend engineer

### 3.6 Admin Dashboard
- **What:** Build an internal admin page showing: total users, episodes generated today/week/month, API costs by provider, failed episode rate, top topics, revenue. Protected by role check.
- **Why:** Operational visibility. Cannot run a business without business metrics.
- **Effort:** M (4-5 days)
- **Priority:** P1
- **Owner:** Full stack engineer

### 3.7 Email Notifications
- **What:** Send transactional emails for: welcome, episode completed, daily briefing ready, approaching usage limit, subscription renewal. Use Resend or Postmark.
- **Why:** Re-engagement. Users who don't return to the app need a nudge. "Your daily briefing is ready" email drives habitual engagement.
- **Effort:** M (3-4 days)
- **Priority:** P2
- **Owner:** Backend engineer

### 3.8 Multi-Language Support
- **What:** Add language selection to episode config. Adapt prompts to instruct Claude to generate scripts in the target language. Filter ElevenLabs voices by language capability. Add i18n to the UI.
- **Why:** Expands TAM significantly. News podcast generation is globally relevant.
- **Effort:** L (7-10 days)
- **Priority:** P2
- **Owner:** Full stack engineer

---

## Phase 4: Growth & Moat (Weeks 25-52)

Goal: Build competitive differentiation that cannot be easily replicated. Expand distribution. Build network effects.

### 4.1 Custom Voice Cloning
- **What:** Allow Pro/Team users to clone their own voice via ElevenLabs Instant Voice Cloning API. Use their voice as narrator/host for generated episodes.
- **Why:** Deep personalization creates switching costs. Users who hear their own voice hosting a podcast are far more engaged.
- **Effort:** L (7-10 days)
- **Priority:** P1
- **Owner:** Full stack engineer

### 4.2 Public Podcast Publishing
- **What:** Allow users to publish episodes to a public podcast feed. Generate a show page with branding, episode list, and embedded player. Submit to podcast directories (Apple, Spotify, Google).
- **Why:** Transforms Pod-Faster from a private tool into a publishing platform. Public podcasts drive organic discovery.
- **Effort:** L (10-14 days)
- **Priority:** P1
- **Owner:** Full stack engineer

### 4.3 Source Integration Expansion
- **What:** Add source integrations beyond Tavily/news: YouTube transcripts, podcast transcripts (via Whisper), PDF/document upload, URL content extraction. Users can say "make a podcast about this YouTube video."
- **Why:** News is just the starting point. The real value is turning any information source into audio content.
- **Effort:** L (10-14 days)
- **Priority:** P1
- **Owner:** Backend engineer

### 4.4 Collaborative Workspaces
- **What:** Add workspace model: invite team members, share topics, share voice presets, shared episode library. Add role-based access (admin, editor, viewer).
- **Why:** B2B expansion. Marketing teams, media companies, and educators need shared workflows.
- **Effort:** XL (14-21 days)
- **Priority:** P2
- **Owner:** Full stack team

### 4.5 API for Developers
- **What:** Expose the podcast generation pipeline as a REST API with API key authentication. Offer a developer tier with per-episode pricing.
- **Why:** Platform play. Let others build on top of Pod-Faster. Creates a moat through integration lock-in.
- **Effort:** L (7-10 days)
- **Priority:** P2
- **Owner:** Backend engineer

### 4.6 Recommendation Engine
- **What:** Based on user topics, listening history, and engagement patterns, suggest new topics and trending stories. "Users who listen to AI news also generate episodes about robotics."
- **Why:** Reduces friction. Users do not need to come up with topics every day. Increases episodes per user.
- **Effort:** L (7-10 days)
- **Priority:** P3
- **Owner:** ML/Backend engineer

### 4.7 Spotify/Apple Podcast App Integration
- **What:** Build a Spotify or Apple Podcasts integration so users can trigger episode generation from within their podcast app.
- **Why:** Meet users where they already are. Reduces the need for them to visit the Pod-Faster web app.
- **Effort:** XL (14+ days, depends on platform API availability)
- **Priority:** P3
- **Owner:** Full stack engineer

---

## Critical Path and Dependencies

The following dependency chains determine the critical path to revenue:

```
Rate Limiting (1.1) + Search Auth Fix (1.2) + Cost Controls (1.4)
    --> Safe for public traffic
    --> Wire Chat Interface (2.1) + Onboarding (2.5)
        --> Usable product for beta users
        --> Analytics (2.7) + Legal Pages (2.8)
            --> Ready for public launch

Pipeline Hardening (1.6) --> Queue-Based Pipeline (3.3)
    --> Reliable long-episode generation
    --> Daily Briefings (2.2) (depends on reliable pipeline)

Queue-Based Pipeline (3.3) + Stripe (3.1) + Usage Metering (3.2)
    --> First revenue (monetization enabled)
```

**Parallelizable work streams:**
- Logging/monitoring (1.3, 1.8) can proceed independently of all other work.
- CI/CD hardening (1.9) is independent.
- RSS Feed (2.3) is independent of the chat interface work.
- Code deduplication (1.10) is independent.

**Key bottleneck:** Queue-based pipeline (3.3) blocks both daily briefings and reliable monetization. Consider starting it in Phase 1 alongside hardening work, not waiting until Phase 3.

---

## Key Metrics Dashboard

### Phase 1 (Weeks 1-4): Infrastructure Health
| Metric | Target | Measurement |
|--------|--------|-------------|
| Uptime | 99.5% | Health check endpoint monitoring |
| Pipeline success rate | >90% | `completed` / (`completed` + `failed`) episodes |
| P95 pipeline duration | <120s for 5-min episodes | Structured log timestamps |
| Daily API cost | <$50 | Token/character tracking + pricing lookup |
| Error rate (5xx) | <1% of requests | Server logs |

### Phase 2 (Weeks 5-12): Engagement
| Metric | Target | Measurement |
|--------|--------|-------------|
| Weekly signups | 100+ | Auth events |
| Activation rate (1st episode within 24h of signup) | >40% | Episode creation timestamps |
| D7 retention | >25% | Return visits within 7 days |
| Episodes per active user per week | >2 | Episode count / WAU |
| Daily briefing opt-in rate | >30% of active users | Active topics count |

### Phase 3 (Weeks 13-24): Revenue
| Metric | Target | Measurement |
|--------|--------|-------------|
| Free-to-paid conversion | >5% | Stripe subscription events |
| Monthly Recurring Revenue (MRR) | $5,000 by week 24 | Stripe dashboard |
| Churn rate | <8% monthly | Subscription cancellations |
| Customer Acquisition Cost (CAC) | <$15 | Marketing spend / new paying users |
| Lifetime Value (LTV) | >$60 (6+ months) | Revenue / churned users |

### Phase 4 (Weeks 25-52): Scale
| Metric | Target | Measurement |
|--------|--------|-------------|
| MRR | $25,000+ by week 52 | Stripe |
| Total registered users | 10,000+ | Auth table |
| Episodes generated per day | 500+ | Episode table |
| API developer signups | 50+ | API key table |
| NPS score | >40 | In-app survey |

---

## Unit Economics Model

### Cost Per Episode (5-minute episode, Sonnet 4 model)

> **Model versions in code:** `claude-sonnet-4-20250514` for summarization and script generation, `claude-haiku-4-5-20251001` for topic extraction. Defined in `src/lib/ai/anthropic.ts`.

| Component | Usage | Unit Cost | Cost Per Episode |
|-----------|-------|-----------|-----------------|
| Claude (Sonnet 4) - Summarize | ~3,000 input + ~1,000 output tokens | $3/$15 per MTok | ~$0.024 |
| Claude (Sonnet 4) - Script | ~2,000 input + ~2,000 output tokens | $3/$15 per MTok | ~$0.036 |
| Claude (Haiku 4.5) - Topic extraction | ~500 input + ~200 output tokens | $1.00/$5 per MTok | ~$0.002 |
| ElevenLabs TTS | ~5,000 characters | ~$0.18/1K chars (Scale) or ~$0.30/1K (Creator) | ~$0.90-1.50 |
| Tavily Search | 2 queries | $0.004/query (Scale) | ~$0.008 |
| Supabase Storage | ~5 MB | ~$0.021/GB | ~$0.0001 |
| Vercel Compute | ~60s execution | ~$0.00003/GB-s | ~$0.002 |
| **Total COGS per 5-min episode (Creator plan)** | | | **~$1.57** |
| **Total COGS per 5-min episode (Scale plan)** | | | **~$0.97** |

> **Note:** ElevenLabs overage pricing varies by plan: Creator = $0.30/1K chars, Pro = $0.24/1K, Scale = $0.18/1K, Business = $0.12/1K. The Scale plan ($275/mo) includes 2M characters/month (~400 five-minute episodes), making the effective per-episode cost significantly lower if within quota. The figures above assume overage rates as a conservative worst case.

### Cost Per Episode (5-minute, optimized with Haiku 4.5 for summarize)

| Component | Usage | Unit Cost | Cost Per Episode |
|-----------|-------|-----------|-----------------|
| Claude (Haiku 4.5) - Summarize | ~3,000 input + ~1,000 output tokens | $1.00/$5 per MTok | ~$0.008 |
| Claude (Sonnet 4) - Script | ~2,000 input + ~2,000 output tokens | $3/$15 per MTok | ~$0.036 |
| ElevenLabs (Scale overage) | ~5,000 characters | ~$0.18/1K chars | ~$0.90 |
| Other | | | ~$0.01 |
| **Total COGS per 5-min episode (Scale overage)** | | | **~$0.95** |

**Key insight:** ElevenLabs is 90%+ of COGS. Claude costs are negligible in comparison. Cost optimization must focus on ElevenLabs: subscribing to the Scale plan ($275/mo for 2M chars), negotiating volume pricing for Business/Enterprise tier ($0.12/1K or lower), shorter episodes, and cheaper TTS models when available. Within the Scale plan's included quota, the ElevenLabs marginal cost per episode is effectively $0, making the COGS per episode as low as ~$0.07 (Claude + infra only).

### Pricing Scenarios

The economics depend heavily on which ElevenLabs plan Pod-Faster subscribes to and whether usage stays within the included quota.

| Tier | Price | Episodes/Month | EL Plan | COGS/Month | Gross Margin |
|------|-------|---------------|---------|------------|-------------|
| Free | $0 | 3 | Scale (within quota) | ~$0.21 (Claude only) | -100% |
| Free | $0 | 3 | Creator (overage) | ~$4.71 | -100% |
| Pro | $9.99 | 30 | Scale ($275/mo, amortized) | ~$2.10 Claude + $8.25 EL amort. = ~$10.35 | -4% |
| Pro | $14.99 | 30 | Scale (within 2M char quota) | ~$2.10 Claude + $8.25 EL amort. = ~$10.35 | +31% |
| Pro | $14.99 | 30 | Business ($0.12/1K overage) | ~$2.10 + $18 = ~$20.10 | -34% |
| Credits | $1.99/ep | 10 avg | Scale (within quota) | ~$0.07/ep + EL amort. | +60%+ at scale |

> **Amortization note:** Scale plan costs $275/mo for 2M characters. At 5,000 chars/episode, that covers ~400 episodes. The per-episode amortized ElevenLabs cost is $275/400 = $0.69/episode. At 30 episodes/month, you are paying $275 for $0.69 x 30 = $20.63 worth of capacity, but you need that minimum plan to unlock Scale pricing.

**Critical finding:** The unit economics are viable but highly sensitive to ElevenLabs plan selection and volume:

1. **Usage-based pricing (recommended for launch):** Charge per episode or per minute of audio generated. At $1.99-2.99 per episode with Scale plan amortization, gross margins of 40-75% are achievable once volume exceeds ~140 episodes/month (breakeven on the $275 Scale subscription).
2. **Subscription + Scale plan:** A $14.99/month subscription with 30 episodes/month is marginally viable only if total platform volume justifies the Scale plan's 2M character quota. This requires ~50+ paying subscribers to amortize the ElevenLabs fixed cost.
3. **Hybrid (recommended for growth):** Free tier with 3 episodes. Credits system: $9.99 buys 5 credits (episodes). Unused credits roll over. This ensures positive unit economics from the first paid transaction.

### Break-Even Analysis

Assumes ElevenLabs Scale plan ($275/mo fixed) as the base infrastructure cost, plus per-episode variable costs.

| Scenario | Monthly Users | Paying Users (5%) | Avg Revenue/User | Monthly Revenue | Monthly COGS | Break-Even? |
|----------|-------------|-------------------|------------------|----------------|-------------|-------------|
| Credits ($1.99/ep), low vol | 500 | 25 | $5.97 (3 eps) | $149 | $275 EL + $5.25 Claude = $280 | No (-88%) |
| Credits ($1.99/ep), med vol | 2,000 | 100 | $5.97 (3 eps) | $597 | $275 EL + $21 Claude = $296 | Yes (50% margin) |
| Credits ($2.99/ep), med vol | 2,000 | 100 | $8.97 (3 eps) | $897 | $275 EL + $21 Claude = $296 | Yes (67% margin) |
| Subscription $14.99, high vol | 5,000 | 250 | $14.99 | $3,748 | $275 EL + $175 Claude = $450 | Yes (88% margin, within quota) |

> **Breakeven threshold:** With a credits model at $1.99/episode, the platform needs ~140 paid episodes/month to cover the $275 ElevenLabs Scale subscription. This equates to roughly 47 paying users generating 3 episodes each. Below this threshold, use the Creator plan ($0.30/1K overage, no fixed cost) and accept lower margins.

**Recommendation:** Launch with a per-episode credit system, not flat-rate subscriptions. Start on the ElevenLabs Creator plan (no fixed cost, $0.30/1K chars). Migrate to Scale plan once volume exceeds ~140 episodes/month. This aligns costs with revenue and avoids both negative gross margins and premature fixed-cost commitments.

---

## Risk Register

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| 1 | ElevenLabs price increase breaks unit economics | Medium | Critical | Negotiate enterprise pricing early. Evaluate alternatives (PlayHT, LMNT, open-source models). Implement cost-per-episode display to set user expectations. |
| 2 | Vercel function timeout kills long episodes | High | High | Migrate to queue-based pipeline (Inngest) in Phase 3. Add per-step timeouts. Limit free tier to 5-minute episodes. |
| 3 | Prompt injection via topic query | Medium | Medium | Input sanitization (Phase 1.5). Content filtering. Claude's built-in safety is the primary defense. |
| 4 | Unbounded API spend from abusive users | High | High | Rate limiting (Phase 1.1). Per-user daily caps (Phase 1.4). IP-level blocking for egregious abuse. |
| 5 | Google/Spotify launches competing feature | Medium | High | Move fast on retention features (daily briefings, RSS). Build switching costs (custom voices, topic history). Focus on niche (news-to-podcast) rather than general AI audio. |
| 6 | ElevenLabs dialogue API deprecation | Low | Medium | Fallback to sequential TTS already implemented. Monitor API changelog. Test fallback path regularly. |
| 7 | Claude model version deprecation | Low | Low | Model IDs are centralized in `anthropic.ts`. Single-point update. Pin specific versions. |
| 8 | Supabase outage blocks all functionality | Low | Critical | No mitigation needed at current scale. At scale: multi-region Supabase or move to self-hosted Postgres with read replicas. |
| 9 | GDPR/privacy compliance gap | Medium | High | Add privacy policy page. Implement data export. Implement data deletion. Chat messages contain user intent data -- ensure retention policies are clear. |
| 10 | Single developer key-person risk | High | High | Document architecture decisions. Maintain comprehensive tests. Use CLAUDE.md orchestration pattern for onboarding new contributors. |
| 11 | Audio quality degradation at scale | Medium | Medium | ElevenLabs may throttle or degrade quality under high concurrent load. Implement request queuing to avoid burst traffic. Monitor audio quality metrics (if ElevenLabs provides them). Test with concurrent generation loads before launch. |
| 12 | Data loss from Supabase Storage | Low | Critical | Audio files in Supabase Storage are the primary deliverable. Enable Supabase point-in-time recovery (PITR) on the database. For audio files, consider cross-region replication or periodic backup to a secondary store (e.g., Cloudflare R2). |
| 13 | Regulatory risk beyond GDPR (CCPA, EU AI Act) | Medium | High | The EU AI Act requires disclosure when content is AI-generated. CCPA requires California-resident data rights. Add AI disclosure metadata to generated episodes. Implement data subject request handling. Consult legal counsel before launching in EU/California. |
| 14 | ElevenLabs API latency spikes causing UX degradation | Medium | Medium | Sequential TTS calls for a 10-segment script mean one slow response blocks all downstream segments. Add per-segment timeout (30s). Implement partial completion -- if 8/10 segments succeed, deliver partial audio and retry the rest. Log latency per segment for monitoring. |
| 15 | Supabase free tier limits during growth | Medium | High | Supabase free tier has 500MB database, 1GB storage, 50K auth monthly active users. A single 30-min episode is ~30MB of audio. Storage will be the first limit hit (~33 episodes). Upgrade to Supabase Pro ($25/mo) before launch. Budget for $25-75/mo in Supabase costs. |

---

## Team Scaling Plan

### Solo Phase (Now - Week 8)
- **You (Founder/Engineer):** Full stack. Focus on Phase 1 hardening and Phase 2 core features. Use Claude Code agents for implementation velocity.

### First Hire (Week 8-12)
- **Product Designer/Frontend Engineer:** Someone who can own the conversational UX, onboarding flow, and mobile experience. The current UI is functional but generic -- a designer can make the chat-first experience feel magical.
- **Why now:** Phase 2 features are heavily UX-dependent. The chat interface, onboarding flow, and sharing features need design thinking, not just engineering.

### Second Hire (Week 12-16)
- **Backend/Infrastructure Engineer:** Owns the pipeline queue migration, cost optimization, monitoring infrastructure, and API development.
- **Why now:** Phase 3 requires infrastructure that a frontend-leaning team cannot build efficiently. Queue-based execution, billing integration, and cost optimization are specialized backend work.

### Third Hire (Week 20-28)
- **Growth/Marketing Hire (or contractor):** Content marketing, SEO, social media presence, partnership outreach. Could be a contractor or part-time initially.
- **Why now:** By week 20, the product should be ready for growth investment. Without someone focused on acquisition, engineering effort is wasted.

### Scale Team (Week 28+)
- Hire based on bottlenecks. Likely order: second frontend engineer, DevOps/SRE, customer support. Do not hire ahead of demand.

---

## Appendix: Architecture Decision Records

### ADR-1: Why Per-Episode Credits Over Subscriptions

**Decision:** Launch with per-episode credit pricing ($1.99-2.99/episode), not flat-rate monthly subscriptions.

**Context:** ElevenLabs TTS costs $0.90-1.50 per 5-minute episode depending on the plan tier (Scale overage: $0.18/1K chars, Creator overage: $0.30/1K chars). A $9.99/month subscription allowing 30 episodes could cost $27-45 in ElevenLabs fees alone on overage pricing.

**Alternatives considered:**
- *Flat-rate subscription:* Negative gross margin until volume justifies a Scale plan ($275/mo for 2M chars). Requires 50+ paying subscribers to amortize. Too risky pre-PMF.
- *Freemium with ads:* Podcast listeners hate ads. Would damage the premium positioning.
- *Bring-your-own-API-key:* Eliminates COGS entirely but creates terrible UX and limits TAM to developers.

**Consequence:** Per-episode credits align revenue with costs from the first transaction. Migrate to subscription model once volume exceeds Scale plan breakeven (~140 episodes/month).

### ADR-2: Why Inngest for Queue-Based Pipeline

**Decision:** Use Inngest as the async job queue for pipeline execution.

**Context:** The current pipeline runs as a single long-running serverless function via `runPipeline()`. Vercel's function timeout (10s free, 300s Pro) will fail on episodes longer than ~5 minutes. The pipeline needs step-level retries, timeouts, and observability.

**Alternatives considered:**
- *Vercel `waitUntil` (current approach):* Works for short episodes but is undocumented (`globalThis.__nextWaitUntil`), has no retry logic, no step-level timeouts, and no monitoring. Not production-grade.
- *QStash (Upstash):* HTTP-based message queue. Simpler than Inngest but lacks step-based orchestration. Would require manually chaining 5 HTTP calls. No built-in monitoring dashboard.
- *AWS SQS + Lambda:* Production-proven but requires leaving the Vercel ecosystem. Adds infrastructure management overhead that conflicts with the serverless-first approach.
- *BullMQ + Redis:* Requires a persistent Redis instance and a long-running worker process. Does not fit Vercel's serverless model.
- *Trigger.dev:* Similar to Inngest. Viable alternative but smaller community and less mature Vercel integration.

**Consequence:** Inngest runs natively on Vercel serverless, requires no separate infrastructure, supports step-based execution with automatic retries and timeouts per step, and provides a built-in monitoring dashboard. Lowest migration friction from the current fire-and-forget model.

### ADR-3: Why Not Build a Mobile App (Yet)

**Decision:** Invest in responsive web + PWA + RSS feed instead of a native mobile app.

**Context:** Podcasts are primarily consumed on mobile. The question is whether to build a native iOS/Android app or invest in web-based mobile experience.

**Alternatives considered:**
- *React Native app:* Shares some code with the web app but requires separate build pipeline, app store submissions, and ongoing platform-specific maintenance. 3-4 month investment for a solo developer.
- *Flutter app:* Cross-platform but requires learning Dart. No code sharing with the Next.js web app.
- *Capacitor/Ionic wrapper:* Wraps the web app in a native shell. Quick but produces a subpar experience -- app store reviewers may reject it.
- *PWA only:* Progressive Web App with service worker for offline, Web Push for notifications, and Media Session API for lock screen controls. Covers 80-90% of use cases at 10% of the effort.

**Consequence:** A responsive web app with PWA capabilities, background audio via Media Session API, and RSS feed integration covers 90% of mobile use cases. A native app should only be built after validating PMF and seeing clear demand for capabilities only native can provide (reliable background downloads, CarPlay/Android Auto integration, Siri/Google Assistant shortcuts).

### ADR-4: Why Chat-First Over Form-First

**Decision:** The primary creation flow is conversational (chat), not form-based.

**Context:** The `ChatInterface` component, `useChat` hook, `MessageBubble`, `TopicChips`, and `VoiceInputButton` are fully built but currently orphaned (the Chat page only renders an `EpisodeConfig` dialog). The question is whether to wire up the chat UX or simplify to a form-first approach.

**Alternatives considered:**
- *Form-first (current de facto state):* The "Quick Generate" button on the Chat page opens a config dialog. Fast, predictable, but undifferentiated -- every competitor (NotebookLM, Podcastle, etc.) uses forms.
- *Chat-only:* Fully conversational. Users never see a form. Higher UX risk -- some users want to just generate quickly without conversation.
- *Chat-first with form fallback (recommended):* Default experience is conversational topic exploration. A "Quick Generate" shortcut remains for power users. Best of both worlds.

**Consequence:** Chat-based topic exploration is the primary differentiator. Users who do not know exactly what they want to hear benefit from the conversation. The code is already built; wiring it into the Chat page is a ~3-4 day effort (Phase 2.1). The "Quick Generate" button stays as a power-user shortcut.

### ADR-5: Why Supabase Realtime Over Polling for Episode Status

**Decision:** Replace HTTP polling with Supabase Realtime subscriptions for episode status updates.

**Context:** The `useEpisodeStatus` hook polls `GET /api/episodes/[id]` every 2 seconds. A multi-minute pipeline generates 60-180+ redundant API calls per episode.

**Alternatives considered:**
- *Server-Sent Events (SSE):* Requires a long-lived connection from the API route. Works on Vercel but ties up a serverless function for the entire duration.
- *WebSocket (custom):* Requires a persistent WebSocket server. Does not fit Vercel's serverless model without a separate service.
- *Supabase Realtime:* Built into the existing Supabase client. Subscribe to row changes on the `episodes` table filtered by episode ID. No additional infrastructure needed.
- *Inngest event streaming:* If Inngest is adopted (ADR-2), its event system could push status updates. But this couples the frontend to the job queue implementation.

**Consequence:** Supabase Realtime is zero-infrastructure since the client already exists. Eliminates polling overhead. Provides instant status updates. Natural fit for the existing stack.
