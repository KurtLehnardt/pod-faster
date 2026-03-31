# Phase 4 — Decision Log

## /try Page

**Q: Should the /try page use the existing `/api/generate` endpoint?**
A: No. The existing `/api/generate` requires authentication and an existing episode row with voice config. For the free tool, we need a separate `/api/try/generate` endpoint that creates an anonymous episode with sensible defaults (no auth required). The /try page polls a `/api/try/status` endpoint for progress. These API routes still need to be implemented — the page is wired up and ready.

**Q: What voice config should anonymous generations use?**
A: Sensible defaults should be configured server-side in the `/api/try/generate` handler — a default monologue narrator voice or a host+guest pair for interview format. This keeps the /try page simple (no voice picker).

**Q: How to handle rate limiting?**
A: A TODO comment in the code notes that server-side IP rate limiting should be added. Recommended approach: Upstash Redis with a 1-generation-per-IP-per-24h limit, checked in the `/api/try/generate` endpoint.

**Q: Should generated episodes be tied to a user?**
A: For the free tool, episodes need a `user_id` (FK constraint). Options: (a) create an anonymous Supabase user, (b) use a dedicated "anonymous" system user ID, or (c) make `user_id` nullable. Decision deferred to API implementation — the client page doesn't care.

## /listen/[id] Page

**Q: Should the listen page require the episode to be "completed"?**
A: Yes. The query filters by `status = 'completed'` so in-progress or failed episodes return 404. This prevents exposing broken states.

**Q: Should we use signed URLs for audio?**
A: Yes. Audio files are in Supabase Storage and require signed URLs. We generate a 1-hour signed URL server-side and pass it to the client component. The URL will expire, which is acceptable for share links (the page can be refreshed to get a new one).

**Q: What share text format?**
A: Kept it simple and direct: "I just listened to an AI-generated podcast about [topic] -- check it out!" The emoji from the spec was kept only in the share button pre-fill text, not in metadata.

## AEO Infrastructure

**Q: What domain to use in sitemap/robots.txt?**
A: Uses `NEXT_PUBLIC_SITE_URL` env var with fallback to `https://pod-faster.com`. This allows different values in staging vs production.

**Q: How many episodes to include in sitemap?**
A: Capped at 500 most recent completed episodes. For larger volumes, a sitemap index with pagination would be needed.

**Q: What to include in JSON-LD?**
A: Added Organization + SoftwareApplication schemas to the root layout. Kept it minimal and accurate.

## Layout Changes

**Q: Should title template override the landing page title?**
A: Used `title.template` with `%s | Pod-Faster` so child pages get consistent branding, with `title.default` for the homepage.
