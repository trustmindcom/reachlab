# Stats Engine & AI Pipeline Rework Design

**Goal:** Replace the current multi-stage AI agent loop (which writes its own SQL and produces jargon-heavy output) with a deterministic stats engine that pre-computes a plain-English report, fed to a single LLM interpretation call that produces actionable, human-readable insights.

**Scope:** Stats engine, AI pipeline rework, LinkedIn knowledge base, dashboard/UX fixes, writing prompt integration, analysis gaps feedback loop, and post content backfill visibility.

---

## 1. Stats Engine

A new module `server/src/ai/stats-report.ts` that queries the database and produces a structured plain-English report. No LLM involved — pure SQL and JS math.

### Engagement Rate Formula

Standard industry formula:

```
Engagement Rate = (reactions + comments + reposts) / impressions × 100
```

- This replaces all references to "WER" (Weighted Engagement Rate) throughout the system.
- Saves and sends are tracked as separate signals, surfaced when notable (e.g., "this post had 14 saves — 3x your median").
- The standard formula keeps numbers comparable to industry benchmarks.

### Statistical Methods

- **Central tendency:** Median (not mean) — engagement data is right-skewed, a single viral post ruins averages.
- **Variability:** IQR (interquartile range) alongside median.
- **Group comparisons:** Cliff's delta effect size for format comparisons (nonparametric, robust to skew). Only flag differences where n ≥ 10 per group.
- **Sample size discipline:** Flag claims as "directional" when n < 10 per group. Don't slice data more than 2 ways with n = 50.
- **Rate metrics:** Per-post median engagement rate for comparisons (not aggregate total/total, which is susceptible to Simpson's paradox).

### Report Sections

The stats report is a plain-text string with these sections:

1. **Overview** — Total posts, date range, median engagement rate + IQR, benchmark context ("2.1% median — solid for a ~5K follower account"), follower count + monthly growth rate.

2. **Recent vs Baseline** — Last 14 days compared to full history. Median engagement, post count, standout posts. E.g., "Your last 5 posts averaged 3.1% engagement vs your all-time median of 2.1%."

3. **Format Comparison** — For each content type with n ≥ 5: median engagement rate, median impressions, median comments, median saves, median sends, sample size. Cliff's delta comparing each format to overall median. Plain English: "Image posts (n=28) have 2.3% median engagement vs 2.1% for text posts (n=20) — negligible difference."

4. **Top 10 Posts** — By engagement rate, described by hook text/content preview + date + all metrics. E.g., "Your post about due diligence questions (Mar 11, image) — 2,007 impressions, 1.7% engagement, 26 reactions, 4 comments." For posts without content text: "Untitled post (Feb 11, image) — 9,300 impressions..."

5. **Bottom 10 Posts** — Same treatment for contrast.

6. **Day-of-Week Breakdown** — Median engagement per day in user's timezone, sample sizes. Notes any missing days (e.g., no weekend posts).

7. **Time-of-Day Breakdown** — 4 windows in user's timezone: morning (6-10), midday (10-14), afternoon (14-18), evening (18-22). Median engagement + sample size per window.

8. **Comment Quality Analysis** — Posts bucketed by comment count (0-4, 5-14, 15-29, 30+), showing median reposts, saves, and sends per bucket. Identifies which posts drove threaded conversations vs top-level-only comments (when data is available).

9. **Saves & Sends Highlights** — Median saves/sends per post, plus outliers (posts with saves or sends > 2x median).

10. **Posting Frequency** — Posts per week over last 90 days, any correlation with engagement.

11. **Content Gaps** — Posts missing text content (count), posts missing image classification, untagged posts, no weekend data, etc.

12. **Author's Writing Prompt** — Full text of the user's current writing prompt (from settings).

### Implementation

- `buildStatsReport(db: Database, timezone: string, writingPrompt: string | null): string`
- Reads only from the database for stats; the writing prompt is passed in as a parameter to keep the function's dependencies explicit.
- All times converted to user's timezone before formatting.
- Posts referenced by hook text/content preview + date, never by ID.
- Numbers always include plain-English context and sample sizes.

### Cliff's Delta Implementation

Cliff's delta is computed as: for all pairs (x_i, y_j) across two groups, count how many times x > y minus how many times x < y, divided by n*m. Effect size thresholds (Vargha & Delaney, 2000): |d| < 0.147 = negligible, < 0.33 = small, < 0.474 = medium, ≥ 0.474 = large. Implemented from scratch (simple nested loop, O(n*m), fine for n < 250). No external library needed.

---

## 2. AI Pipeline Rework

### Current Architecture (being replaced)

- 3-stage agent loop: pattern detection → hypothesis testing → synthesis
- Each stage runs up to 15 turns with `query_db` tool (arbitrary SQL)
- 3 parallel synthesis runs with voting for consistency
- Total: ~15-45 LLM calls per refresh
- Produces jargon-heavy output (WER, post IDs, UTC times)

### New Architecture

**Step 1: Generate stats report.** `buildStatsReport(db, timezone)` returns a plain-English string. Pure code, no AI.

**Step 2: Single LLM interpretation call.** One Sonnet call with extended thinking (~10K token budget). System prompt includes:
- LinkedIn platform knowledge base (see Section 3)
- Language rules (no jargon, no post IDs, explain WHY, use user's timezone)
- User's feedback history (what they found useful/not useful from prior runs)
- Output schema definition

User message is the stats report.

**Step 3: Store results.** Insights and recommendations go into existing DB tables. New: `data_gaps` stored in `ai_analysis_gaps` table (see Section 6). Prompt suggestions stored for Coach page display.

**Step 4: Overview summary.** One Haiku call to generate the short overview summary for the dashboard header, from the insights/recommendations. Top performer post ID is determined deterministically by the stats engine (highest engagement rate post) and passed through — the LLM only generates the human-readable reason and summary text. Enforces the same language rules.

**Total LLM calls per refresh:** 2 (one Sonnet for analysis, one Haiku for overview).

### What Gets Removed

- `server/src/ai/tools.ts` — `query_db` and `submit_analysis` tool definitions deleted.
- 3-stage agent loop in `analyzer.ts` — replaced with single interpretation call.
- 3-run voting in synthesis — removed (deterministic input = consistent output).
- WER formula from `prompts.ts` — removed entirely.
- `runAgentLoop()` function — replaced with a direct `client.messages.create()` call.

### What Gets Kept

- **Taxonomy discovery and post tagging** (`tagger.ts`) — kept as a pre-analysis step. Runs before the stats report is generated so that topic tags are available for the stats engine to reference.
- **Image classification** (`image-classifier.ts`) — kept as a pre-analysis step. Image tags feed into the stats report's format comparison section.
- The orchestrator still calls these steps before generating the stats report and running the interpretation call.

### Error Handling

If the Sonnet interpretation call fails (rate limit, malformed JSON, network error):
1. Retry once after a 5-second delay.
2. If the retry fails, log the error to `ai_logs` and mark the run as `failed` in `ai_runs`.
3. The dashboard continues showing the previous run's results (insights/recommendations are not cleared on failure).
4. The Haiku overview call has the same retry-once policy.

### Output Schema

The LLM produces structured JSON:

```json
{
  "insights": [
    {
      "category": "string",
      "stable_key": "string",
      "claim": "string (plain English, no jargon)",
      "evidence": "string (with specific numbers and post references by content)",
      "confidence": "STRONG | MODERATE | WEAK",
      "direction": "positive | negative | neutral"
    }
  ],
  "recommendations": [
    {
      "key": "string (snake_case stable ID)",
      "type": "quick_win | experiment | long_term | stop_doing",
      "priority": 1-3,
      "confidence": "STRONG | MODERATE | WEAK",
      "headline": "string",
      "detail": "string (explains WHY, references specific posts by content)",
      "action": "string (specific next step for this week)"
    }
  ],
  "overview": {
    "summary_text": "string (2-3 sentences)",
    "quick_insights": ["string"]
  },
  "prompt_suggestions": {
    "assessment": "working_well | suggest_changes",
    "reasoning": "string",
    "suggestions": [
      {
        "current": "string (text from current prompt)",
        "suggested": "string (proposed replacement)",
        "evidence": "string (why this change, based on data)"
      }
    ]
  },
  "gaps": [
    {
      "type": "data_gap | tool_gap | knowledge_gap",
      "stable_key": "string (snake_case, e.g. 'missing_post_content')",
      "description": "string",
      "impact": "string"
    }
  ]
}
```

### Language Rules (in system prompt)

- Never use abbreviations or internal metric names. Say "engagement rate" not "WER."
- When referencing specific posts, describe them by their topic/hook text and include the date. Never reference posts by ID number.
- All numbers must have plain-English context. Don't say "0.0608" — say "6.1% engagement rate."
- Times must be in the user's local timezone, written as "Tuesday 3pm ET" not "14-17h."
- Don't just identify what works — explain WHY it works (referencing LinkedIn platform mechanics when relevant) and give a specific next action the author can take this week.
- Compare recent posts (last 14 days) to baseline — notice what the author is changing and whether it's working.

---

## 3. LinkedIn Knowledge Base

A curated reference file `server/src/ai/linkedin-knowledge.md` included in the AI's system prompt. Contains non-obvious, data-backed insights about LinkedIn's platform mechanics that an LLM wouldn't know from training data. Organized by confidence level.

### HIGH CONFIDENCE (LinkedIn Engineering papers + large-scale studies)

**Feed Retrieval (2026 architecture):**
- LinkedIn's feed uses a fine-tuned LLaMA 3 dual encoder that generates text-only embeddings for both members and content. Image-only posts with thin captions are nearly invisible to candidate retrieval.
- Raw engagement counts have -0.004 correlation with relevance internally. LinkedIn converts all metrics to percentile buckets (1-100). A post at the 90th percentile of impressions in a niche topic scores equivalently to a post at the 90th percentile in a popular topic.
- The Interest Graph layer can distribute up to 30% of a post's reach to users outside the creator's direct network, based on professional topic affinity.
- There is no "5-10% test audience" batch. Feed ranking is per-viewer, per-request — every feed refresh evaluates all candidate content against that specific member's profile, history, and interests.

**Dwell Time:**
- P(skip) model is content-type-relative (percentile-based, not absolute seconds). It asks "did this hold attention longer than similar posts of its type?"
- Clicking "see more" is a positive engagement signal that starts/extends the dwell time clock. Posts that earn the click AND hold attention past ~15 seconds get a reach multiplier.
- Content completion rate matters more than raw engagement. A 5-slide carousel viewed completely outperforms a 100-slide carousel with more likes.

**Comments:**
- Comment quality is scored via NLP/ML (XGBoost for triage, 360Brew 150B parameter LLM for substance/lexical diversity analysis), not simple word-count heuristics. A 5-word specific question may score higher than a 50-word generic response.
- Threaded conversations (indirect comments / replies to other comments) boost reach ~2.4x vs top-level-only comments (AuthoredUp, 621K posts).
- Commenter identity matters. LinkedIn generates member profile embeddings via Qwen3 0.6B that encode professional identity. Comments from people whose expertise is semantically related to the post's content carry more weight.
- Pod-like behavior (repetitive comment patterns, similar phrasing across comments) is specifically detected and devalued via lexical diversity analysis.

**Content Format:**
- Carousels: 6-9 slides optimal (down from 12-13 in 2024). Below 35% click-through rate, posts get a visibility penalty.
- Single-image posts dropped 30% below text-only in 2026 — likely because the text-only retrieval system cannot "see" images for candidate selection. Substantial captions compensate.
- External links lose ~60% reach vs native content.
- Video views declined 36% YoY despite increased posting. Text-only retrieval disadvantages video unless it has rich captions/transcripts.
- Newsletters bypass the algorithm entirely (triple notification: email + push + in-app). Accounts with newsletters get 2.1x reach on regular posts (halo effect).

**Topic Authority:**
- 360Brew requires 60-90 days of consistent posting on 2-3 focused topics before recognizing expertise and optimizing distribution. Topic-hopping gets depressed reach.
- The system cross-references post content against the author's profile (headline, about, experience). Content misaligned with stated expertise gets suppressed distribution.
- 80%+ of content should be within 2-3 core topics for proper classification.

**Posting Frequency:**
- Higher posting frequency = better per-post performance (Buffer, 2M+ posts, fixed-effects regression). No cannibalization effect. The jump from 1 to 2-5 posts/week is the biggest marginal lift.
- Hashtags are essentially irrelevant for distribution in the 2026 algorithm.

### MEDIUM CONFIDENCE (single practitioner source or inferred)

- Creator reply within 15 minutes gives ~90% boost (GrowLeads, single source). Mechanism confirmed: fresh interaction signals during highest-weight window of Feed SR's recency-weighted loss function.
- Comments 15x more valuable than likes for distribution (Postiv AI, 2M posts). Mechanism confirmed but exact multiplier uncertain.
- Quality signals (saves, thoughtful comments) now 4-6x more important than likes under the new algorithm.
- Peak engagement shifted to 3-8 PM in 2026 (Buffer, 4.8M posts).
- Delayed engagement (24-72h) still has value through the suggested feed channel.
- Content can distribute for 1-3 weeks (not just 48-72 hours) under the 2026 percentile-based freshness system.

### LOW CONFIDENCE (widely cited but no primary source)

- "15+ words = 2.5x comment weight" — specific threshold not found in any primary source. Likely a gradient based on semantic analysis, not a step function.
- "3+ exchanges between different participants = 5.2x amplification" — unverifiable.
- AI text detection/deprioritization — no confirmed system exists for text. LinkedIn has published face-generation detection (99.6% TPR for GANs) but not text detection.
- "Creator credibility score" — no public documentation. The system uses expertise signals and historical activity patterns that function similarly.

### Engagement Rate Benchmarks

- Below 2%: Underperforming
- 2-3.5%: Solid / average
- 3.5-5%: Good
- Above 5%: Exceptional
- Smaller accounts (1-5K followers) typically see 4-8%; larger accounts (10K+) see 1-3%.
- 2026 platform-wide average: ~5.2% (inflated by carousel-heavy pages).

### Anti-Gaming

- LinkedIn's spam system achieves 98.7% automated removal rate (LinkedIn Transparency Report, Jan-Jun 2025).
- Engagement pods explicitly prohibited. Detection uses temporal velocity analysis and network graph patterns.
- Automation prohibited under User Agreement Section 8.2.13 (bots for creating, commenting, liking, sharing).

---

## 4. Dashboard & UX Fixes

### 4a. Kill WER

All references to "WER" or raw decimal engagement numbers are eliminated. The new pipeline produces plain-English output by design — the stats report uses percentages and relative comparisons, and the language rules enforce human-readable output.

### 4b. Post References Use Content

Posts are described by hook text/content preview + date throughout. The stats report formats them this way, and the AI inherits the framing. Where posts appear in insights/recommendations, they link to the post detail view in the app.

### 4c. Times in User's Timezone

- On every dashboard page load, the browser sends `Intl.DateTimeFormat().resolvedOptions().timeZone` to the server.
- Server stores it in a `settings` table row (key: `timezone`).
- If the timezone differs from what's stored (user traveled), it updates automatically.
- The stats report converts all times using this timezone.
- AI output uses format like "Tuesday 3pm ET."

### 4d. Timing Page Highlights

Instead of burying best posting times in AI text on the Coach page, the Timing page itself highlights the best windows visually:
- Green highlight on heatmap cells that are above the median engagement rate.
- Short text summary at the top: "Your strongest windows: Tuesday and Thursday, 2-5pm ET."
- Based on the pre-computed stats, not AI-generated text.

### 4e. Author Photo Feedback

After uploading a photo on the Settings page, show the photo immediately as a preview. If the upload fails, show an error message. Replace the current silent fire-and-forget behavior.

### 4f. Backfill Status Indicator

On the Posts page, if posts are missing content: a subtle banner — "Content pending for N posts — open LinkedIn with the extension active to backfill." Disappears when the queue is clear. The count comes from `SELECT COUNT(*) FROM posts WHERE full_text IS NULL`.

### 4g. Data Gaps on Coach Page

Collapsible section at the bottom of the Coach page: "What's limiting your insights." Shows the AI's logged data gaps from the most recent run, sorted by `times_flagged` descending. Persistent gaps (flagged 3+ runs) get highlighted.

---

## 5. Writing Prompt Integration

### Storage

New rows in the `settings` table:
- `writing_prompt` — the user's current LinkedIn writing prompt text.

New table `writing_prompt_history`:
```sql
CREATE TABLE writing_prompt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_text TEXT NOT NULL,
  source TEXT NOT NULL,  -- 'manual_edit' | 'ai_suggestion'
  suggestion_evidence TEXT,  -- AI's reasoning, if source is ai_suggestion
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Every time the prompt changes (whether from accepting a suggestion or manual edit), a snapshot is saved with timestamp and source.

### Settings Page

- Textarea for viewing/editing the writing prompt.
- "Save" button for manual edits.
- "History" expandable section showing revision history with timestamps, source tags, and diffs.

### Stats Report

Section 12 of the stats report includes the full text of the current writing prompt, so the AI can reference it in its analysis.

### AI Output

The `prompt_suggestions` field in the analysis output:
```json
{
  "assessment": "working_well | suggest_changes",
  "reasoning": "Your recent posts using question hooks got 2.8x median comments...",
  "suggestions": [
    {
      "current": "Start with a compelling hook",
      "suggested": "Start with a specific, debatable question about the reader's domain",
      "evidence": "3 of your top 5 posts by comment count opened with domain-specific questions"
    }
  ]
}
```

### Coach Page Display

New section after recommendations: "Writing Prompt Review."
- If `working_well`: green indicator — "Your writing prompt is aligned with what's performing."
- If `suggest_changes`: shows each suggestion with:
  - Current text vs suggested text
  - Evidence (why this change, based on data)
  - **Accept** button — applies the change to the stored prompt, saves to revision history with source `ai_suggestion`
  - **Reject** button — dismisses the suggestion, logged as feedback so the AI learns what the user doesn't want

---

## 6. Analysis Gaps Feedback Loop

### Storage

New table:
```sql
CREATE TABLE ai_analysis_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES ai_runs(id),
  gap_type TEXT NOT NULL,  -- 'data_gap' | 'tool_gap' | 'knowledge_gap'
  description TEXT NOT NULL,
  impact TEXT NOT NULL,
  times_flagged INTEGER DEFAULT 1,
  first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### How It Works

At the end of every analysis run, the AI outputs a `gaps` array. Each gap includes a `stable_key` (snake_case identifier like `missing_post_content` or `no_timezone_configured`). The server upserts each gap matching on `gap_type` + `stable_key`. If the same gap has been flagged before, increment `times_flagged`, update `last_seen_at`, and update `description`/`impact` with the latest text. This avoids deduplication issues from varying LLM phrasing.

### Coach Page Display

Collapsible section at the bottom: "What's limiting your insights." Shows gaps from the latest run, sorted by `times_flagged` descending. Persistent gaps (flagged 3+ runs) get a highlight to indicate they're worth addressing.

### Development Workflow

Periodically review the `ai_analysis_gaps` table. If something shows up consistently (e.g., "no post content text for analysis"), it signals what to prioritize next — whether that's improving the scraper, adding a new data source, or updating the knowledge base.

---

## 7. Database Changes Summary

### New Tables

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE writing_prompt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_text TEXT NOT NULL,
  source TEXT NOT NULL,
  suggestion_evidence TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_analysis_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES ai_runs(id),
  gap_type TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  description TEXT NOT NULL,
  impact TEXT NOT NULL,
  times_flagged INTEGER DEFAULT 1,
  first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

The `settings` table is a new general-purpose key-value store. Initial keys:
- `timezone` — user's timezone string (e.g., "America/New_York"), auto-detected from browser
- `writing_prompt` — user's LinkedIn writing prompt text

### Column Type Changes

The existing `insights` table stores `confidence` as `REAL` (e.g., 0.5, 0.9). The new output uses string labels (`STRONG`, `MODERATE`, `WEAK`). The migration maps: `STRONG` → stored as `"STRONG"` in the column (change column interpretation from numeric to string). The `recommendations` table `confidence` and `priority` columns undergo the same change. Existing rows with numeric values are left as-is — the dashboard display code already handles both via `getConfidenceLabel()` and `getPriorityLabel()` which accept both strings and numbers.

### Removed/Changed

- WER formula removed from all prompts and code.
- `tools.ts` (`query_db`, `submit_analysis`) deleted.
- Agent loop machinery in `analyzer.ts` replaced with single LLM call.

---

## 8. File Structure

### New Files
- `server/src/ai/stats-report.ts` — stats engine, pure functions
- `server/src/ai/linkedin-knowledge.md` — curated LinkedIn platform knowledge
- `server/src/__tests__/stats-report.test.ts` — stats engine tests
- `server/src/db/migrations/NNN-stats-engine.sql` — new tables and settings

### Modified Files
- `server/src/ai/orchestrator.ts` — replace pipeline with stats report → single LLM call
- `server/src/ai/prompts.ts` — new system prompt with knowledge base + language rules
- `server/src/ai/analyzer.ts` — simplify to single interpretation call
- `server/src/routes/insights.ts` — store gaps, serve prompt suggestions
- `server/src/routes/settings.ts` — timezone auto-detect endpoint, writing prompt CRUD, prompt history
- `server/src/app.ts` — register new routes
- `dashboard/src/pages/Coach.tsx` — prompt suggestions UI, data gaps section, accept/reject buttons
- `dashboard/src/pages/Settings.tsx` — writing prompt editor, photo upload feedback, prompt history
- `dashboard/src/pages/Timing.tsx` — visual highlights for best windows
- `dashboard/src/pages/Posts.tsx` — backfill status banner
- `dashboard/src/pages/Overview.tsx` — remove WER references from AI summary display
- `dashboard/src/api/client.ts` — new API types and endpoints

### Deleted Files
- `server/src/ai/tools.ts` — query_db and submit_analysis tools no longer needed

---

## 9. Testing Strategy

- **Stats engine:** Unit tests for each report section. Test with known data to verify medians, Cliff's delta, timezone conversion, and plain-English formatting. Test edge cases: 0 posts, 1 post, all same format, missing content.
- **AI pipeline:** Integration test that mocks the LLM call and verifies the full flow: stats report generation → LLM call with correct prompt → result storage (insights, recommendations, gaps, prompt suggestions).
- **Knowledge base:** Snapshot test to ensure the knowledge base file is included in the system prompt.
- **Route integration tests:** New endpoints (timezone PUT, writing prompt CRUD, prompt history GET, gaps GET, prompt suggestion accept/reject) get integration tests via Fastify's `inject()` — same pattern as existing `insights-routes.test.ts`.
- **Dashboard:** Manual testing of each UX fix. Verify timezone auto-detection, prompt editing, accept/reject suggestions, backfill banner, data gaps display.
- **Prompt history:** Test that every prompt change (manual and AI-suggested) creates a history entry with correct source tag.
