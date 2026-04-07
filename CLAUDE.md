# ReachLab

LinkedIn analytics + AI-powered content generation platform. Three workspaces: `server`, `dashboard`, `extension`.

## Commands

```bash
pnpm dev                                    # Start server (3211) + dashboard (3210) with hot reload
pnpm test                                   # Run server tests (vitest)
pnpm build:dashboard                        # Build dashboard for production
pnpm --filter linkedin-analytics-extension build  # Build Chrome extension
pnpm kill-existing                          # Kill processes on ports 3210-3212
```

Server type-check: `npx tsc --noEmit --project server/tsconfig.json`
Dashboard type-check: `npx tsc --noEmit --project dashboard/tsconfig.json`

## Ports

- **3210**: Dashboard (Vite dev in dev mode, API + static files in production)
- **3211**: API server (dev mode only)

The extension always talks to `localhost:3210`. In dev, Vite proxies `/api` to 3211.

## Environment Variables

| Variable | Purpose |
|---|---|
| `TRUSTMIND_LLM_API_KEY` | OpenRouter API key (required for AI) |
| `OPENAI_API_KEY` | OpenAI key for voice interview TTS/STT |
| `REACHLAB_DB` | DB path (default: `data/linkedin.db`) |

Loaded from `server/.env` via a hand-rolled parser (not dotenv). Won't override existing env vars.

**First run**: Create `server/.env` with required keys. DB and migrations are created automatically on first server startup.

## Architecture

### Server (`server/src/`)

- **Fastify v5**, ESM (`"type": "module"`). All imports use `.js` extensions even for `.ts` files.
- `buildApp(dbPath)` factory in `app.ts` — creates Fastify instance, initializes DB, registers routes. Tests use this with a test DB.
- Routes split across: `app.ts` (core/ingest), `routes/insights.ts`, `routes/settings.ts`, `routes/generate.ts`, `routes/profile.ts`.
- All API routes under `/api/` prefix.
- **No ORM** — raw SQL via `better-sqlite3` `.prepare()` throughout.
- Heavy use of dynamic `import()` for lazy-loading AI modules (fire-and-forget background work).
- `/api/ingest` is the hub — triggers image downloads, video transcription, AI tagging, and full analysis pipeline. All async.

### AI (`server/src/ai/`)

- Uses `@anthropic-ai/sdk` routed through **OpenRouter** (`baseURL: "https://openrouter.ai/api"`).
- Custom fetch in `client.ts` converts `x-api-key` to `Authorization: Bearer` for OpenRouter.
- Models (OpenRouter IDs): `HAIKU` (claude-3.5-haiku), `SONNET` (claude-sonnet-4-6), `OPUS` (claude-opus-4-6), `GPT54` (gpt-5.4), `SONAR_PRO` (perplexity/sonar-pro).
- Cost tracking built in — per-model pricing with 5.5% OpenRouter fee.
- AI pipeline is two-tier: cheap tagging on every sync, full interpretation on schedule (daily/weekly) with post-count threshold.

### Database (`server/src/db/`)

- **SQLite** with WAL mode, foreign keys ON, 5s busy_timeout.
- DB at `data/linkedin.db` (relative to project root).
- `schema.sql` creates base tables. Numbered migrations (`NNN-description.sql`) in `migrations/` run automatically on startup.
- Stale AI runs (status `running` > 1 hour) auto-marked `failed` on startup.

**Naming conventions:**
- Tables: snake_case plural (`posts`, `ai_tags`, `generation_rules`)
- Foreign keys: `_id` suffix (`post_id`, `run_id`)
- JSON columns: `_json` suffix (`drafts_json`, `retro_json`)
- Booleans: INTEGER 0/1 (`enabled`, `acted_on`)
- Timestamps: `created_at`/`updated_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)

### Dashboard (`dashboard/src/`)

- **React + TypeScript + Vite**. No router library — hash-based tab switching via `useState`.
- **Tailwind CSS v4** — config lives in `index.css` under `@theme`, not a config file.
- **Two color palettes**: Main app uses `surface-*`/`text-*`/`accent`. Generate pages use `gen-*` prefix for a distinct darker aesthetic.
- Fonts: DM Sans (sans), JetBrains Mono (mono), Newsreader (serif, Generate pages via `.font-serif-gen`).
- **No state library** — pure `useState`/`useEffect`, props drilling.
- **No data-fetching library** — raw `useEffect` + `api.xxx()` calls. Errors often silently caught.
- All API types and methods live in `api/client.ts` (single file, 800+ lines).
- Startup: checks API keys → onboarding status → main app.

### Chrome Extension (`extension/src/`)

- **Manifest V3**. Content scripts on `linkedin.com/analytics/*` and `/feed/*`.
- Service worker orchestrates scraping via background tabs (alarm-based, 9 AM / 9 PM).
- Two-phase content scraping: hook text first, click "see more", re-scrape for full text.
- **Zod** for runtime validation of scraped data (dashboard does NOT use Zod).
- Offline queue with 5MB cap — retries when server is reachable.
- Pacing: 1-3s between requests, 2-5s during backfill.
- Video URLs captured passively via `webRequest` intercepting DASH manifests.

## Key Gotchas

1. **GPG signing may fail** — if `gpg: signing failed: No pinentry`, use `git -c commit.gpgsign=false commit`.
2. **Extension filter name**: Use `pnpm --filter linkedin-analytics-extension build`, not `pnpm --filter extension build`.
3. **Tailwind v4**: No `tailwind.config.ts`. Theme tokens are in `dashboard/src/index.css` under `@theme`.
4. **ESM imports**: Always use `.js` extensions in server imports (`./app.js`, `../db/index.js`).
5. **Test framework**: Vitest, not Jest.
6. **author_profile is singleton**: `CHECK (id = 1)` — always one row.
7. **Generation rules are user-managed**: The retro system only suggests writing prompt edits, never rules. Rules are the user's manual guardrails.
8. **Ingest triggers cascading work**: A single `/api/ingest` call can trigger image downloads, transcription, tagging, and full AI analysis — all fire-and-forget.

## Code Style

- TypeScript throughout. No explicit return types needed on route handlers.
- Prefer inline SQL over query builders. Use parameterized queries (`?` placeholders).
- Dashboard components: functional only, no class components.
- Only add try-catch at system boundaries (API route handlers, Zod validation). Internal functions should let errors propagate.
- Keep changes minimal — don't refactor surrounding code or add comments to unchanged lines.
