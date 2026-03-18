# Coach UI Redesign — Design Spec

## Goal

Redesign the AI Coach page from a monolithic scrollable panel into a three-tab interface (Actions | Insights | Deep Dive) that separates actionable recommendations from analytical data, with progressive disclosure to prevent information overload.

## Problems with Current Design

1. **Everything stacked vertically** — Recommendations, prompt suggestions, what-changed, and gaps all compete for attention in a single scroll. Users can't quickly find what they need.
2. **No recommendation lifecycle** — Once dismissed mentally, recommendations reappear every refresh. No "Got it" / "Dismiss" with cooldowns.
3. **Prompt suggestions disconnected** — Writing prompt suggestions appear in their own section, disconnected from the recommendation that generated the evidence.
4. **No deep analysis** — No way to answer "Am I getting better?", "What should I write about?", or "What kind of engagement am I getting?"
5. **Best Timing buried** — Timing data (best days/times) is on a separate tab but belongs with insights.

## Architecture

Three tabs, each serving a distinct use case:

- **Actions** — "What should I do next?" — Recommendation cards with accept/dismiss lifecycle
- **Insights** — "What do I know?" — Data patterns, what changed, gaps, timing
- **Deep Dive** — "How am I doing?" — Progress tracking, content opportunities, engagement quality

Tab state managed via `useState<"actions" | "insights" | "deep-dive">` in Coach.tsx. No router needed.

## Tab 1: Actions

### Recommendation Cards

Each recommendation card shows:
- Priority badge (HIGH/MED/LOW) + category + confidence indicator
- Headline (bold) + detail text (secondary)
- "Try next" action box (accent-tinted)
- Inline prompt suggestion (if the recommendation has an associated prompt change) — shown as current vs suggested side-by-side with equal-height boxes and vertical centering of shorter content
- Footer: "Got it" button + "Dismiss" button + thumbs up/down feedback

### Recommendation Lifecycle

- **"Got it"** = User acknowledges and will act on it. Sets `resolved_type = 'accepted'`, `resolved_at = NOW()`. Recommendation won't reappear for 6 months (checked by `stable_key` match against recently resolved).
- **"Dismiss"** = Not relevant. Sets `resolved_type = 'dismissed'`, `resolved_at = NOW()`. Won't reappear for 3 months.
- **Resolved section** — Below active cards, show resolved recommendations with strikethrough (accepted) or muted (dismissed), with date.

### Prompt Suggestions

Prompt suggestions are displayed inline within the recommendation card that generated them, not in a separate section. Each suggestion shows a side-by-side comparison (current vs suggested) with "Apply to prompt" and "Dismiss" buttons.

The recommendation-to-suggestion linkage works via the `evidence_json` field on recommendations — the AI pipeline already stores the evidence that drove each recommendation. Prompt suggestions that don't map to a specific recommendation appear at the end of the actions list as standalone cards.

### Empty State

When no recommendations exist: centered message "No recommendations yet. Click Refresh AI to generate insights from your posts."

## Tab 2: Insights

### Quick Insights

Cards showing data-backed findings. Each card has:
- Claim (bold, primary text)
- Evidence (secondary text with specific numbers)
- Meta row: confidence badge ("Confirmed" green / "New signal" blue) + streak count ("3 consecutive runs")

Data source: `insights` table where `status = 'active'`, ordered by confidence DESC.

### What Changed (collapsible, open by default)

Groups: Confirmed, New Signal, Reversed, Retired. Each group has a colored label and items showing claim + evidence.

Data source: `getChangelog()` function (already exists).

### What's Limiting Analysis (collapsible, closed by default)

Gap cards showing: gap type badge, description, impact, times-flagged indicator (when >= 3x).

Data source: `getLatestAnalysisGaps()` function (already exists).

### Best Timing

Three stat cards in a row:
- Best Days (e.g., "Tue & Thu") with median ER
- Best Time (e.g., "3–8 PM") with median ER
- Frequency (e.g., "2–3x/wk") with current frequency

Data source: existing `/api/timing` endpoint, computed client-side.

## Tab 3: Deep Dive

Three use-case-driven sections with collapsible headers.

### Progress ("Am I getting better?")

Rolling comparison of key metrics across time periods:
- Last 30 days vs previous 30 days
- Metrics: median ER, median impressions, total posts, avg comments/post
- Displayed as a row of KPI cards with delta indicators (+12%, -5%, etc.)
- Trend direction: green for improvement, red for decline, neutral for < 5% change

Data source: New server endpoint that queries `post_metrics` with date filters and computes aggregates.

### Content Opportunities ("What should I write next?")

Category × performance matrix:
- For each `post_category` from `ai_tags`: show post count, median ER, median impressions
- Highlight "underexplored high performers" — categories with fewer than 3 posts but above-median ER
- Highlight "reliable performers" — categories with 3+ posts and consistently above-median ER
- Show as a compact table with category name, post count, median ER, median impressions, and a status badge

Data source: New server endpoint joining `ai_tags.post_category` with `post_metrics`.

### Engagement Quality ("What kind of engagement am I getting?")

Breakdown of engagement composition:
- Comment-to-reaction ratio (higher = more thoughtful engagement)
- Save rate (saves / impressions × 100)
- Repost rate (reposts / impressions × 100)
- Weighted ER using formula: (comments×5 + reposts×3 + saves×3 + sends×3 + reactions×1) / impressions × 100
- Comparison: standard ER vs weighted ER to show quality gap

Data source: New server endpoint aggregating from `post_metrics`.

## DB Changes

### Migration 006: Recommendation Cooldowns

```sql
ALTER TABLE recommendations ADD COLUMN resolved_at DATETIME;
ALTER TABLE recommendations ADD COLUMN resolved_type TEXT; -- 'accepted' or 'dismissed'
ALTER TABLE recommendations ADD COLUMN stable_key TEXT; -- for cross-run deduplication
```

The AI pipeline should populate `stable_key` on recommendations (similar to insights). For existing recommendations without a `stable_key`, the headline serves as a fallback identifier.

### Cooldown Logic

When fetching recommendations for display:
1. Get recommendations from latest completed run
2. Filter out any whose `stable_key` matches a recently resolved recommendation where:
   - `resolved_type = 'accepted'` AND `resolved_at > NOW() - 6 months`
   - `resolved_type = 'dismissed'` AND `resolved_at > NOW() - 3 months`

## New API Endpoints

### `PATCH /api/insights/recommendations/:id/resolve`
Body: `{ type: "accepted" | "dismissed" }`
Sets `resolved_at` and `resolved_type` on the recommendation.

### `GET /api/insights/deep-dive/progress`
Returns: `{ current: MetricsSummary, previous: MetricsSummary }`
Where MetricsSummary = `{ median_er, median_impressions, total_posts, avg_comments }`
Query param: `days=30` (default)

### `GET /api/insights/deep-dive/categories`
Returns: `{ categories: CategoryPerformance[] }`
Where CategoryPerformance = `{ category, post_count, median_er, median_impressions, status }`
Status = "underexplored_high" | "reliable" | "declining" | "normal"

### `GET /api/insights/deep-dive/engagement`
Returns: `{ engagement: EngagementQuality }`
Where EngagementQuality = `{ comment_ratio, save_rate, repost_rate, weighted_er, standard_er, total_posts }`

## Design Language

- Follow existing dashboard design tokens (index.css @theme block)
- Accent blue (#0a66c2) for interactive elements and active tab indicator only
- Surface grays for all card backgrounds — no competing colors
- JetBrains Mono for numeric values, DM Sans for everything else
- Staggered fade-up animations on tab switch (existing `fadeUp` pattern)
- Collapsible sections use the existing chevron rotation pattern
- Cards: `bg-surface-1 border border-border rounded-lg` (consistent with rest of dashboard)

## Out of Scope

- Post drill-down ("Why did this post work?") — separate feature on Posts page
- AI pipeline changes to generate new recommendation types
- Follower growth correlation (data gap flagged in analysis)

## Testing

- Tab switching: verify each tab loads its data independently
- Recommendation resolve: click "Got it", verify card moves to resolved section, verify it doesn't reappear after refresh
- Cooldown: resolve a recommendation, trigger AI refresh, verify same stable_key doesn't produce a new active card
- Deep Dive progress: verify delta calculations match manual computation
- Content categories: verify category counts match actual post counts per category
- Engagement quality: verify weighted ER formula matches specification
- Empty states: verify graceful display when no data exists for each section
