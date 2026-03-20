# Generate Flow Redesign: Real Web Research + Manual Topics + Tab Caching

## Summary

Redesign the Generate tab research pipeline to use real web sources instead of LLM-fabricated stories. Add manual topic input so users can write about something specific. Fix tab caching so switching between News/Topic/Insight doesn't re-fetch.

## Problem

1. **Research is fabricated** — the current researcher generates story ideas purely via LLM with no real web search. Headlines, sources, and angles are all made up.
2. **No manual input** — users can only auto-generate; they can't write about a topic they already know about.
3. **Tab switching re-fetches** — clicking between News/Topic/Insight triggers a new API call every time, even when switching back to a type already researched.

## Architecture

### Two-Stage Research Pipeline

```
Manual topic ──→ [Sonar Pro deep dive] ──→ [Claude synthesis] ──→ Story cards
                        ↑
Auto-generate ──→ [RSS discovery] ──→ [Claude ranks top 5] ──→ [Sonar Pro deep dive (top 3)] ──→ [Claude synthesis] ──→ Story cards
```

**Entry points:**
- **Manual**: User types a topic → skip RSS, go straight to Sonar Pro deep dive
- **Auto**: RSS feeds → Claude ranks → Sonar Pro deep dives → synthesis

**Ranking → deep dive gap**: Claude ranks ~5 candidates. The top 3 get Sonar Pro deep dives and become full story cards. The remaining 2 are discarded (they served only as ranking context).

### Stage 1: RSS Discovery (auto-generate only)

Fetch enabled RSS feeds from `research_sources` table in parallel:

| Source | Feed URL | Frequency | Coverage |
|--------|----------|-----------|----------|
| no.security | `https://no.security/rss.xml` | Daily | Security threat intel, vulnerabilities, breaches |
| tl;dr sec | `https://rss.beehiiv.com/feeds/xgTKUmMmUm.xml` | Weekly | Security deep dives, supply chain, cloud |
| Import AI | `https://importai.substack.com/feed` | Weekly | AI research analysis |
| AI News (smol.ai) | `https://news.smol.ai/rss.xml` | Daily | AI community aggregator |
| Axios | `https://api.axios.com/feed/` | Ongoing | General tech, filter for AI/automation |

- Per-feed timeout: 5 seconds. Feeds that timeout or error are silently skipped.
- Minimum viable: if at least 1 feed returns results, proceed. If all 5 fail, return an error to the user.
- Filter to items published within the past week
- Extract headline + link + summary from each
- Pass combined list to Claude Haiku to rank top ~5, influenced by post type:
  - **News**: prioritize breaking/recent stories, hard news
  - **Topic**: prioritize trends, debates, emerging themes
  - **Insight**: prioritize lessons-learned angles, practitioner-relevant stories
- Dedup against recent story headlines: new query `getRecentStoryHeadlines(db, 30)` returns headlines from the last 30 research stories. Claude's ranking prompt includes these as "avoid stories similar to these recently-used topics."

### Stage 2: Sonar Pro Deep Dive

For the top 3 topics (auto) or 1 manual topic, call Perplexity Sonar Pro in parallel.

**API**: `POST https://api.perplexity.ai/chat/completions` (OpenAI-compatible format, no new SDK needed)
**Model**: `sonar-pro`
**Response includes**: `citations: string[]` — real source URLs

Search prompts vary by post type:
- **News**: "Find recent news coverage, reactions, and analysis about [topic] from the past week. Include multiple sources and perspectives."
- **Topic**: "Find current discussions, debates, and different perspectives on [topic]. What are practitioners saying? What's controversial?"
- **Insight**: "Find practitioner experiences, case studies, and lessons learned about [topic]. What worked, what failed, what surprised people?"

**Manual topic**: Sonar Pro searches for the user's topic. The synthesis step produces 3 story cards with different angles on that single topic (not 1 card). This gives the user meaningful choice even when they've specified what to write about.

**Error handling**: If Sonar Pro fails for one topic, return the others. If all fail, fall back to RSS headlines as degraded story cards (headline + summary from RSS, no deep dive context, no source URLs).

### Stage 3: Claude Synthesis

Claude (Haiku) reformats Sonar Pro results into the story card JSON format:
```json
{
  "headline": "string",
  "summary": "string",
  "source": "string — real source name",
  "source_url": "string — real URL from Sonar Pro citations",
  "age": "string",
  "tag": "string",
  "angles": ["string"],
  "is_stretch": false
}
```

Note: `source_url` is a new field added to the `Story` interface in `generate-queries.ts` and `GenStory` in `client.ts`.

## Data Model

### New table: `research_sources`

```sql
CREATE TABLE research_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'rss',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO research_sources (name, feed_url) VALUES
  ('no.security', 'https://no.security/rss.xml'),
  ('tl;dr sec', 'https://rss.beehiiv.com/feeds/xgTKUmMmUm.xml'),
  ('Import AI', 'https://importai.substack.com/feed'),
  ('AI News', 'https://news.smol.ai/rss.xml'),
  ('Axios', 'https://api.axios.com/feed/');
```

The `rss-fetcher.ts` module reads enabled sources from this table at runtime (`SELECT * FROM research_sources WHERE enabled = 1`), making it easy to add/remove/disable feeds without code changes.

### Existing tables — changes needed

- `Story` interface in `generate-queries.ts`: add optional `source_url?: string` field
- `GenStory` type in `dashboard/src/api/client.ts`: add optional `source_url?: string` field
- `stories_json` in `generation_research`: stories are serialized as JSON including all fields. Since `Story` interface gains `source_url`, it will automatically be included in `stories_json` serialization. No schema change needed.
- `sources_json` in `generation_research`: currently `[{ name: "AI-generated story ideas" }]`. Now populated with real source metadata from Sonar Pro citations: `[{ name: "Krebs on Security", url: "https://..." }, ...]`
- `source_count` in `generation_research`: now represents the number of unique citation URLs returned by Sonar Pro (real sources), not `1`

### New query: `getRecentStoryHeadlines`

Stories are stored as `stories_json` (JSON array) in `generation_research`. To dedup by headline, we parse the JSON in application code:

```typescript
export function getRecentStoryHeadlines(db: Database.Database, limit: number): string[] {
  const rows = db.prepare(
    `SELECT stories_json FROM generation_research ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as { stories_json: string }[];
  const headlines: string[] = [];
  for (const row of rows) {
    const stories = JSON.parse(row.stories_json) as Story[];
    headlines.push(...stories.map(s => s.headline));
  }
  return headlines;
}
```

This queries the last N research sessions and extracts headlines from their stored stories JSON. Provides headline-level dedup — avoids resurfacing the same story even if it spans categories.

### Environment

- New env var: `PERPLEXITY_API_KEY`

## API Changes

**`POST /api/generate/research`** — same endpoint, modified behavior:
- Existing param: `postType` (news | topic | insight)
- New optional param: `topic?: string` — when provided, skips RSS and goes straight to Sonar Pro
- New optional param: `avoid?: string[]` — headlines to avoid when re-fetching (for "New research" button)
- Response shape: `{ research_id, stories, article_count, source_count }` — unchanged structure, but `stories[].source_url` is now populated with real URLs

No new endpoints needed.

## New function signature

```typescript
export async function researchStories(
  client: Anthropic,           // Still needed for Claude Haiku ranking + synthesis
  db: Database.Database,
  logger: AiLogger,
  postType: string,
  options?: {
    topic?: string;            // Manual topic — skip RSS, go straight to Sonar Pro
    avoid?: string[];          // Headlines to exclude (for re-fetch freshness)
  }
): Promise<ResearchResult>
```

## Server-Side File Changes

| File | Change |
|------|--------|
| `server/src/ai/rss-fetcher.ts` | **Create**: Fetch + parse RSS feeds from `research_sources` table, filter to this week, 5s per-feed timeout |
| `server/src/ai/researcher.ts` | **Rewrite**: Orchestrate RSS → rank → Sonar Pro → synthesize. New signature with `options` param |
| `server/src/db/migrations/011-research-sources.sql` | **Create**: `research_sources` table + seed data |
| `server/src/db/generate-queries.ts` | **Modify**: Add `source_url?: string` to `Story` interface, add `getRecentStoryHeadlines()` query |
| `server/src/routes/generate.ts` | **Modify**: Accept optional `topic` and `avoid` params, pass to researcher |

## Frontend File Changes

| File | Change |
|------|--------|
| `dashboard/src/api/client.ts` | **Modify**: Add `source_url?: string` to `GenStory`, update `generateResearch` to accept optional `topic` and `avoid` params |
| `dashboard/src/pages/Generate.tsx` | **Modify**: Change `GenerationState` to use per-type cache structure |
| `dashboard/src/pages/generate/StorySelection.tsx` | **Modify**: Add manual topic input, implement cache-aware tab switching, progressive loading states |
| `dashboard/src/pages/generate/components/StoryCard.tsx` | **Modify**: Make `source` a clickable link when `source_url` is present |

## Frontend Changes

### StorySelection.tsx — new initial state

When no stories are cached for the current post type:

```
[News] [Topic] [Insight]

┌─────────────────────────────────────────────┐
│  "I want to write about..."                 │
│  [text input________________________] [Go]  │
│                                             │
│  ── or ──                                   │
│                                             │
│  [Find me something]                        │
└─────────────────────────────────────────────┘
```

- Typing a topic + Go → calls research API with `topic` param
- "Find me something" → calls research API without `topic` (RSS auto-discovery)
- Post type tabs remain in same position, influence research

### Tab caching

State shape changes to per-type cache in `Generate.tsx`:

```typescript
interface TypeCache {
  stories: GenStory[];
  researchId: number | null;
  articleCount: number;
  sourceCount: number;
}

interface GenerationState {
  postType: PostType;
  cache: Record<PostType, TypeCache | null>;
  // These are global — they apply to the currently selected story regardless of type
  selectedStoryIndex: number | null;
  personalConnection: string;
  // ... drafts state unchanged
}
```

- `selectedStoryIndex` clears on tab switch since it refers to a position in a type-specific list. `personalConnection` is global and persists across tab switches (it's about the user's connection to any story, not type-specific).
- Switching tabs: check `cache[type]` — if populated, show instantly, no API call. Clear `selectedStoryIndex`.
- "New research" button and "Find me something" both clear the current type's cache before fetching, passing the previous stories' headlines as `avoid` to ensure fresh results
- Manual topic search: results populate `cache[currentType]` so switching away and back preserves them. A new manual search or "Find me something" overwrites the cache for that type.

### Progressive loading states

Research now takes 10-17s (up from ~3s). The spinner needs to communicate progress:

1. "Scanning news feeds..." (during RSS fetch, ~1-3s)
2. "Finding the best stories..." (during Claude ranking, ~2-3s)
3. "Researching in depth..." (during Sonar Pro deep dive, ~5-8s)
4. "Preparing your stories..." (during synthesis, ~2-3s)

For manual topic: skip step 1-2, show "Researching [topic]..." then "Preparing your stories..."

Implementation: the research API endpoint sends progress via a simple approach — the frontend shows timed messages (not server-sent events). Since the stages have predictable durations, client-side timers that advance the message are sufficient.

### Story cards — minor enhancement

Stories now have real source URLs from Sonar Pro. The `source` field on StoryCard becomes a clickable link when `source_url` is present.

## Sonar Pro Integration Details

Simple fetch wrapper — no new SDK dependency:

```typescript
const response = await fetch("https://api.perplexity.ai/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "sonar-pro",
    messages: [{ role: "user", content: searchPrompt }],
  }),
});
```

Top 3 stories get Sonar Pro calls in parallel via `Promise.all`. Total latency = one Sonar Pro call (~5-8s), not three sequential.

**Cost awareness**: Sonar Pro is ~$3/1000 searches. Each auto-research = 3 calls, each manual = 1 call. At typical usage (a few researches per day), cost is negligible. No rate limiting needed for single-user app. Perplexity API costs are not tracked in the existing `calculateCostCents` (which tracks Anthropic API costs) — this is acceptable for now since Perplexity costs are minimal and separate from the Claude usage tracking.

## Performance Budget

| Stage | Expected latency |
|-------|-----------------|
| RSS fetch (5 feeds parallel) | 1-3s |
| Claude Haiku ranking | 2-3s |
| Sonar Pro deep dive (3 parallel) | 5-8s |
| Claude Haiku synthesis | 2-3s |
| **Total (auto)** | **~10-17s** |
| **Total (manual topic)** | **~7-11s** |
