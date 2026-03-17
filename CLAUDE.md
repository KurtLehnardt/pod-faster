# CLAUDE.md — pod-faster

## Stack

Next.js 15 App Router, React 19, TypeScript, Supabase (Postgres + RLS), Tailwind + shadcn/ui, ElevenLabs TTS, Anthropic Claude SDK, Twilio, Stripe. Hosted on Vercel.

## Supabase Migrations

Migration files live in `supabase/migrations/` with sequential naming: `00001_*.sql`, `00002_*.sql`, etc.

### Running migrations against the remote database

```bash
# Token is stored in .env as SUPABASE_TOKEN (quoted). Strip quotes and export:
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_TOKEN=' .env | cut -d= -f2- | tr -d '"')

# Push all pending migrations:
npx supabase db push --linked
```

The project is linked via `supabase/config.toml` (`project_id = "vwakivzxdevkjzigplpu"`). No local Docker is needed — `db push` runs directly against the remote database.

### Creating a new migration

1. Create a new SQL file: `supabase/migrations/NNNNN_description.sql` (next sequential number)
2. Update `src/types/database.types.ts` to match the schema change
3. Run `npx supabase db push --linked` (with `SUPABASE_ACCESS_TOKEN` set as above)

## Validation

```bash
npx tsc --noEmit        # Type check
npx vitest run          # Unit tests
npm run build           # Full build
```

## Key Directories

- `src/lib/pipeline/` — Episode generation pipeline (search → summarize → script → audio → upload)
- `src/lib/elevenlabs/` — TTS and dialogue API clients
- `src/lib/ai/prompts/` — Claude prompt templates
- `src/app/api/` — Next.js API routes
- `src/components/episodes/` — Episode UI components
- `supabase/migrations/` — Database migrations
