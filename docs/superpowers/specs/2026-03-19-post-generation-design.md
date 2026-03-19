# Post Generation — Design Spec

## Goal

Add a post generation pipeline to ReachLab that researches stories, generates draft variations, and produces quality-checked LinkedIn posts. The system uses a 3-layer prompt architecture (writing rules, coaching insights, post type instructions) with incremental honing and anti-narrowing safeguards.

## Pipeline Overview

1. User triggers "Generate" for a post type (News / Topic / Insight)
2. System researches stories from external sources (HN, Twitter, niche feeds)
3. Presents 3 stories (including 1 stretch story) — user picks one
4. Generates 3 draft variations (contrarian, operator, future-facing)
5. User selects 1-3 drafts with optional combining guidance
6. System combines selected drafts into a final draft
7. Quality gate: Sonnet checks against coaching insights + writing rules + anti-AI tropes
8. User reviews/edits final post, then copies or opens in LinkedIn

One-click mode: "Auto-pick best match" skips story selection and goes straight to drafts.

## Navigation

New top-level tab "Generate" in `App.tsx` (added to `tabs` array). The Generate page has 3 sub-tabs:

- **Generate** — the step-by-step pipeline (default)
- **Rules** — writing rules management
- **Generation History** — past generations

Sub-tabs render as a full-width second header row, left-aligned at 32px padding, underline-style with accent indicator, border-bottom separator spanning full width.

---

## Screen: Story Selection (Step 1)

### Layout
- Header row: "Pick a story to write about" + post type pills (News / Topic / Insight) right-aligned
- 3 story cards stacked vertically
- No progress bar, no subtitle

### Story Cards
- Newsreader serif headline (19px), summary (14px, text-2), meta row (tag + source + age)
- Selected card: blue left bar, blue-filled radio, blue tag badge
- "Possible angles" hint visible only on selected card
- Stretch story: amber "STRETCH" badge

### Bottom Bar
- Left: "New research" ghost button + article/source count (text-2)
- Right: "Auto-pick best match" skip link + "Generate drafts" primary button

### Data Flow
```
User clicks "Generate" tab
  → POST /api/generate/research { post_type: "news"|"topic"|"insight" }
  → Server calls research pipeline (external sources)
  → Returns { research_id, stories: Story[3], article_count, source_count }
  → UI renders story cards

User selects story + clicks "Generate drafts"
  → POST /api/generate/drafts { research_id, story_index, post_type }
  → proceeds to Step 2
```

---

## Screen: Draft Variations (Step 2)

### Layout
- Sidebar (280px) + reading area
- Sidebar: "VARIATIONS" label (10px uppercase, letter-spacing 1.4px, text-2), 3 draft items
- Each item: neutral gray badge (Contrarian / Operator / Future), title, "Include in final" toggle
- Active draft: left blue bar (3px accent)
- Reading area: 44px/56px padding

### Content Structure
- **Hook**: Newsreader serif, 26px, text-0
- **Body**: Satoshi, 15.5px, line-height 1.85, text-1, white-space pre-line
- **Closing**: Newsreader italic, 15.5px, text-0, top border separator
- **Meta**: word count (bold) + structure description (text-2)

### Interactions
- Click sidebar item: fade-up animation, switches reading area
- Toggle "Include in final" independently of active selection
- Count badge updates dynamically
- Button text: "Review" for 1 draft, "Combine & review" for 2+

### Guidance
- "Direction for combining" label (text-0, 13px, font-weight 600)
- Textarea: bg-2, border-2, placeholder text-3
- Hidden when only 1 draft selected

### Bottom Bar
- Left: "Back to stories" ghost button
- Right: count badge + "Review" / "Combine & review" primary button

### Data Flow
```
Server returns from Step 1:
  → { generation_id, drafts: Draft[3] }
  → Each draft: { type, hook, body, closing, word_count, structure_label }

User selects drafts + optional guidance + clicks action button
  → POST /api/generate/combine {
      generation_id,
      selected_drafts: number[],     // indices
      combining_guidance?: string
    }
  → If 1 draft: skip combine, go straight to quality gate
  → If 2+: LLM combines, then quality gate
  → Returns { generation_id, final_draft, quality_gate }
  → proceeds to Step 3
```

---

## Screen: Review & Edit (Step 3)

### Layout
- Two-column: editor panel (flex) + sidebar (320px)

### Editor Panel
- Auto-sizing textarea with full post content, directly editable
- Footer: Regenerate / Shorten / Strengthen close buttons (bg-3, border-2, text-1, 6px/14px padding) + word count
- Free-text instruction: "Tell the AI what to change" input + Apply button

### Sidebar Cards
1. **Quality gate** — Passed/Warning badge, checklist items with green check or amber warn:
   - Voice match (does it sound like the user?)
   - AI tropes (checked against anti-AI trope rules)
   - Hook strength (opens with friction/claim, not a question or context dump)
   - Engagement close (process question, not opinion question)
   - Concrete specifics (uses named tools/metrics/experiences, not abstractions)
   - Ending quality (extends the idea, doesn't summarize or recap)
2. **Post details** — Story title, drafts used, structure, est. read time
3. **Guidance applied** — coaching insights that influenced the draft, left-border accent notes

### Bottom Bar
- Left: "Back to drafts" ghost button
- Right: "Copy to clipboard" secondary + "Open in LinkedIn" primary

### Data Flow
```
Quality gate runs automatically after combine:
  → Sonnet checks final draft against:
    - All active writing rules
    - All active coaching insights
    - Anti-AI trope rules
  → Returns { passed: boolean, checks: QualityCheck[] }

User edits in textarea → local state only (no auto-save to server)

User clicks "Regenerate" / "Shorten" / "Strengthen close":
  → POST /api/generate/revise {
      generation_id,
      action: "regenerate"|"shorten"|"strengthen_close"
    }
  → Returns updated final_draft + re-runs quality gate

User submits free-text instruction:
  → POST /api/generate/revise {
      generation_id,
      action: "custom",
      instruction: string
    }
  → Same response shape

User clicks "Copy to clipboard":
  → navigator.clipboard.writeText(finalDraft)
  → Update generation status to 'copied'

User clicks "Open in LinkedIn":
  → Copy to clipboard + window.open LinkedIn new post URL
  → Update generation status to 'copied'
```

---

## Screen: Rules Sub-Tab

### Layout
- "Writing rules" heading + "Reset to defaults" button
- Subtitle: "Applied to every post you generate. Edit, delete, or add your own."

### Sections (accordion)
1. **Voice & tone** — expanded by default
2. **Structure & formatting** — expanded by default
3. **Anti-AI tropes** — collapsed by default, master toggle to enable/disable entire category

### Individual Rules
- Bullet + rule text + optional italic example
- Rules use **favor/avoid paired format** where applicable: "Favor: [concrete example] — Avoid: [vague alternative]" (inspired by Every.to AI Style Guide)
- Edit/Delete on hover
- "Add a [category] rule..." input at bottom of each section
- No per-rule toggles

### Anti-AI Tropes Dual Use
Rules feed into both the generation prompt and the quality gate assessment prompt.

### Default Rules Reference
Pre-populated rules should draw from:
- **Every.to AI Style Guide** anti-patterns: hedges ("actually," "maybe," "just"), correlative constructions ("not X, but Y"), rhetorical questions as filler, meandering intros, recapping conclusions
- **Performance-killing patterns**: abstract industry analysis without personal stakes, process documentation without emotional arc, theory before practical application, opening with context/history instead of friction
- **Sentence-level**: favor concrete specifics ("$400/month replacing $400k/year") over vague abstractions ("cost-effective"), favor embodied experience over generic descriptions

### Data Flow
```
Page load:
  → GET /api/generate/rules
  → Returns { categories: RuleCategory[] }

Edit/Add/Delete:
  → PUT /api/generate/rules { categories: RuleCategory[] }
  → Full replacement of rules JSON

Reset to defaults:
  → POST /api/generate/rules/reset
  → Replaces with pre-populated defaults
```

---

## Screen: Generation History Sub-Tab

### Layout
- Filter pills: All / Published / Drafts / Discarded
- Table: Post (hook excerpt + story/drafts info), Type, Status, Date
- Open/Reuse actions on hover
- Pagination: "Showing N of M generations - Load more"

### Status Detection
- **Published**: fuzzy-match generated post hook against scraped LinkedIn posts
- **Draft**: default until published or discarded
- **Discarded**: user explicitly discards

### Data Flow
```
GET /api/generate/history?status=all&offset=0&limit=20
  → Returns { generations: GenerationSummary[], total: number }

POST /api/generate/history/:id/discard
  → Sets status to 'discarded'

GET /api/generate/history/:id
  → Full generation record for "Open" action (restores to Review step)
```

---

## Screen: Weekly Coaching Sync Modal

### Trigger
- Appears weekly (or manual open from coaching insights area)
- Based on post performance analysis + coaching pipeline

### Layout
- Modal overlay with backdrop blur
- Header: "Weekly coaching sync" + subtitle + week date + "View revision history" link
- 2 cards per page max, paginated. No scrolling inside modal.

### Change Card Types
1. **NEW** (neutral badge) — new coaching insight. Green-bordered editable block with prompt text. Accept / Skip.
2. **UPDATED** (neutral badge) — modification. Red block (old, strikethrough, not editable) + green block (new, editable). Accept / Skip.
3. **RETIRE** (neutral badge) — insight underperforming. Explanation only. Retire / Keep.

### Editable Text Pattern
- bg-1 background, border-2 border, left accent bar (green for additions, red for removals)
- Directly editable on click, auto-saves on blur

### Footer
- "N proposed changes - M accepted" counter
- Page indicator ("1 of 2") + "Next" / "Previous" + "Done" buttons
- Accept/Skip on each card IS the action (no separate "Apply changes")

### Data Flow
```
Sync trigger (weekly cron or manual):
  → POST /api/generate/coaching/analyze
  → AI reviews full prompt + coaching insights + recent performance
  → Returns { sync_id, changes: CoachingChange[] }

Accept/Skip per card:
  → PATCH /api/generate/coaching/changes/:id { action: "accept"|"skip" }
  → For "accept" on NEW: insert coaching insight
  → For "accept" on UPDATED: update coaching insight in place
  → For "retire": remove coaching insight, log retirement

View revision history:
  → GET /api/generate/coaching/history
  → Returns past sync decisions with timestamps
```

---

## Prompt Architecture (3 Layers)

### Layer 1: Writing Rules (~500-700 tokens)
- Stable, user-editable
- 3 categories: voice/tone, structure/formatting, anti-AI tropes
- Stored in `generation_rules` table
- Pre-populated with researched defaults on first use

### Layer 2: Coaching Insights (~400-600 tokens)
- Evolving, AI-driven, weekly sync
- Capped at ~8 active insights
- Lifecycle: candidate -> active -> under-review -> retired
- Stored in `coaching_insights` table

### Layer 3: Post Type Instructions (~400-600 tokens)
- Per-type templates (news, topic, insight)
- Defines structure, angle expectations, source handling
- Stored in `post_type_templates` table

### Token Budget
- Total: 1,500-2,000 tokens across all 3 layers
- Enforced at assembly time, not at edit time

### Prompt Assembly Order
```
[System] You are a LinkedIn post ghostwriter for {user context}.

[Writing Rules]
{layer 1 — all active rules, grouped by category}

[Coaching Insights]
{layer 2 — all active coaching insights}

[Post Type: {type}]
{layer 3 — template for selected post type}

[Story Context]
{selected story + research data}

[Draft Instructions]
{variation-specific: contrarian / operator / future-facing}
```

---

## Prompt Management

### Incremental Honing
- Change one section per iteration
- Never rewrite > 20% of prompt in a single sync
- Every instruction earns its place

### Conflict Detection
- Self-audit prompt runs before every coaching sync change
- Checks for: redundancy, conflicts, vagueness, token bloat, naturally-followed instructions
- New insights checked against existing rules before adding

### Golden Set Regression
- 5-10 reference posts stored as `golden_posts` in DB
- After any prompt change, regenerate against golden set
- Compare output quality (automated + optional manual review)

### Retirement Lifecycle
- v1 (implemented): prompt hygiene — redundancy, conflicts, vagueness
- v2 (deferred): performance-based — correlate rules to engagement metrics

---

## Anti-Narrowing Mechanisms

### Stretch Stories
- 1 of 3 research stories is intentionally outside user's core topics
- Marked with amber "STRETCH" badge
- Sourced from adjacent-but-different domains

### Interest Evolution Tracking
- Track which topics user selects over time
- Detect narrowing: if last N selections are same category, increase stretch diversity
- Stored in `generation_topic_log`

### Diversity Scoring
- Before presenting stories, score against last 10 generated posts
- Penalize stories too similar to recent outputs
- Factor in: topic overlap, structural similarity, source overlap

---

## Visual Design System

### Typography
- **UI font**: Satoshi — labels, buttons, meta, body text
- **Serif accents**: Newsreader — post hooks, closing questions, story headlines
- **Body text**: Satoshi 15.5px, line-height 1.85, text-1

### Color Palette
- **Single accent**: `#6ba1f5` — badges, toggles, progress, active indicators
- **No multi-color badges** — draft types all neutral gray, active turns blue
- **Background scale**: bg-0 `#09090b` / bg-1 `#0f0f12` / bg-2 `#151518` / bg-3 `#1c1c20` / bg-4 `#232328`
- **Text scale**: text-0 `#f5f5f7` / text-1 `#d1d1d6` / text-2 `#98989f` / text-3 `#6e6e76` / text-4 `#48484d`
- **Border scale**: border-1 `rgba(255,255,255,0.055)` / border-2 `0.09` / border-3 `0.14`
- **Noise texture overlay**: 0.018 opacity

### Buttons
- **Primary**: white bg (text-0), dark text (bg-0), font-weight 500, 13px, border-radius 10px
- **Ghost/back**: no background, text-2, 13px
- **Count badge**: accent-soft bg, accent-border, accent text, 12px bold

### Layout Constants
- App header: sticky, 56px, logo left, nav center-left, sync time right
- Sub-tabs: underline style, accent indicator, full-width border-bottom
- Progress dots: done=blue-soft, current=blue-solid, future=bg-2

---

## Database Schema (Migration 009)

```sql
-- Writing rules for post generation (3 categories)
CREATE TABLE IF NOT EXISTS generation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,           -- 'voice_tone' | 'structure_formatting' | 'anti_ai_tropes'
  rule_text TEXT NOT NULL,
  example_text TEXT,                -- optional italic example
  sort_order INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,        -- for anti-AI tropes master toggle
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Coaching insights (evolving, AI-managed)
CREATE TABLE IF NOT EXISTS coaching_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,         -- the actual instruction injected into prompts
  evidence TEXT,                     -- why this insight exists
  status TEXT NOT NULL DEFAULT 'active',  -- 'candidate' | 'active' | 'under_review' | 'retired'
  source_sync_id INTEGER,            -- which coaching sync introduced it
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  retired_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_coaching_insights_status ON coaching_insights(status);

-- Post type templates
CREATE TABLE IF NOT EXISTS post_type_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_type TEXT NOT NULL UNIQUE,    -- 'news' | 'topic' | 'insight'
  template_text TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Research sessions (step 1 output)
CREATE TABLE IF NOT EXISTS generation_research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_type TEXT NOT NULL,
  stories_json TEXT NOT NULL,         -- JSON array of 3 stories
  sources_json TEXT,                  -- sources metadata
  article_count INTEGER,
  source_count INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Generation records (tracks the full pipeline for one post)
CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_id INTEGER REFERENCES generation_research(id),
  post_type TEXT NOT NULL,
  selected_story_index INTEGER,
  drafts_json TEXT,                   -- JSON array of 3 draft variations
  selected_draft_indices TEXT,        -- JSON array e.g. [0, 2]
  combining_guidance TEXT,
  final_draft TEXT,
  quality_gate_json TEXT,             -- JSON: { passed, checks[] }
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'copied' | 'published' | 'discarded'
  matched_post_id TEXT REFERENCES posts(id),  -- if fuzzy-matched to a published post
  prompt_snapshot TEXT,               -- full assembled prompt used (for debugging/history)
  total_input_tokens INTEGER,
  total_output_tokens INTEGER,
  total_cost_cents REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generations_status ON generations(status);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at);

-- Revision log for edits within a generation
CREATE TABLE IF NOT EXISTS generation_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  action TEXT NOT NULL,               -- 'regenerate' | 'shorten' | 'strengthen_close' | 'custom' | 'combine'
  instruction TEXT,                   -- user instruction for 'custom' action
  input_draft TEXT,                   -- draft before revision
  output_draft TEXT,                  -- draft after revision
  quality_gate_json TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_cents REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generation_revisions_gen ON generation_revisions(generation_id);

-- Weekly coaching sync sessions
CREATE TABLE IF NOT EXISTS coaching_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  changes_json TEXT NOT NULL,         -- proposed changes array
  decisions_json TEXT,                -- user accept/skip/retire decisions
  accepted_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'completed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

-- Coaching insight change history (for revision history view)
CREATE TABLE IF NOT EXISTS coaching_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id INTEGER NOT NULL REFERENCES coaching_syncs(id),
  insight_id INTEGER REFERENCES coaching_insights(id),
  change_type TEXT NOT NULL,          -- 'new' | 'updated' | 'retired'
  old_text TEXT,
  new_text TEXT,
  evidence TEXT,
  decision TEXT,                      -- 'accepted' | 'skipped' | 'kept' | 'retired'
  decided_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_coaching_change_log_sync ON coaching_change_log(sync_id);

-- Golden reference posts for regression testing
CREATE TABLE IF NOT EXISTS golden_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id),
  reason TEXT,                        -- why this is a golden post
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Topic selection log for anti-narrowing
CREATE TABLE IF NOT EXISTS generation_topic_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  topic_category TEXT,
  was_stretch INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generation_topic_log_created ON generation_topic_log(created_at);

-- Seed default post type templates
INSERT OR IGNORE INTO post_type_templates (post_type, template_text) VALUES
  ('news', 'Write a LinkedIn post reacting to a news story. Open with a hook that makes the reader stop scrolling. State a non-obvious take grounded in practitioner experience. One idea per post. Close with a question that invites informed disagreement.'),
  ('topic', 'Write a LinkedIn post exploring a professional topic. Open with a hook based on a surprising insight or counterintuitive claim. Draw from direct experience building, shipping, or operating. Close with a question that triggers substantive practitioner responses.'),
  ('insight', 'Write a LinkedIn post sharing a hard-won professional insight. Open with the sharpest version of the lesson. Provide one concrete example from direct experience. Close with a question that makes other practitioners reflect on their own experience.');
```

---

## API Endpoints

All endpoints under `/api/generate/` prefix. Registered via `registerGenerateRoutes(app, db)` in a new `server/src/routes/generate.ts`.

### Research & Drafting

**`POST /api/generate/research`**
- Body: `{ post_type: "news"|"topic"|"insight" }`
- Calls research pipeline (external source fetching + story selection)
- Returns: `{ research_id: number, stories: Story[], article_count: number, source_count: number }`
- Story shape: `{ headline, summary, source, age, tag, angles: string[], is_stretch: boolean }`

**`POST /api/generate/drafts`**
- Body: `{ research_id: number, story_index: number, post_type: string }`
- Assembles full prompt (3 layers) + story context, generates 3 variations
- Returns: `{ generation_id: number, drafts: Draft[] }`
- Draft shape: `{ type: "contrarian"|"operator"|"future", hook, body, closing, word_count, structure_label }`

**`POST /api/generate/combine`**
- Body: `{ generation_id: number, selected_drafts: number[], combining_guidance?: string }`
- If 1 draft: skip combine, run quality gate only
- If 2+: LLM combines, then quality gate
- Returns: `{ final_draft: string, quality_gate: QualityGate }`
- QualityGate shape: `{ passed: boolean, checks: { name, status: "pass"|"warn", detail }[] }`

**`POST /api/generate/revise`**
- Body: `{ generation_id: number, action: "regenerate"|"shorten"|"strengthen_close"|"custom", instruction?: string }`
- Revises final draft, re-runs quality gate
- Returns: `{ final_draft: string, quality_gate: QualityGate }`

### Rules

**`GET /api/generate/rules`**
- Returns: `{ categories: { voice_tone: Rule[], structure_formatting: Rule[], anti_ai_tropes: { enabled: boolean, rules: Rule[] } } }`
- Rule shape: `{ id, rule_text, example_text?, sort_order }`

**`PUT /api/generate/rules`**
- Body: full categories object (same shape as GET response)
- Replaces all rules

**`POST /api/generate/rules/reset`**
- Resets to pre-populated defaults
- Returns: same shape as GET

### History

**`GET /api/generate/history`**
- Query params: `status`, `offset`, `limit`
- Returns: `{ generations: GenerationSummary[], total: number }`
- Summary shape: `{ id, hook_excerpt, story_headline, drafts_used, post_type, status, created_at }`

**`GET /api/generate/history/:id`**
- Full generation record for reopening

**`POST /api/generate/history/:id/discard`**
- Sets status to 'discarded'

### Coaching Sync

**`POST /api/generate/coaching/analyze`**
- Triggers coaching analysis (full prompt + insights + recent performance)
- Returns: `{ sync_id: number, changes: CoachingChange[] }`
- Change shape: `{ id, type: "new"|"updated"|"retire", title, evidence, old_text?, new_text?, insight_id? }`

**`PATCH /api/generate/coaching/changes/:id`**
- Body: `{ action: "accept"|"skip"|"retire"|"keep", edited_text?: string }`
- Applies the decision

**`GET /api/generate/coaching/history`**
- Returns: `{ syncs: CoachingSyncSummary[] }`

**`GET /api/generate/coaching/insights`**
- Returns: `{ insights: CoachingInsight[] }` (active only)

---

## Key React Components

### New Files

```
dashboard/src/pages/Generate.tsx          — top-level page with sub-tab state
dashboard/src/pages/generate/
  StorySelection.tsx                      — Step 1: story cards + post type pills
  DraftVariations.tsx                     — Step 2: sidebar + reading area
  ReviewEdit.tsx                          — Step 3: editor + quality gate sidebar
  Rules.tsx                               — Rules sub-tab
  GenerationHistory.tsx                   — History sub-tab
  CoachingSyncModal.tsx                   — Weekly sync modal overlay
  components/
    StoryCard.tsx                         — individual story card
    DraftSidebar.tsx                      — variations sidebar with toggles
    DraftReader.tsx                       — reading area (hook/body/closing/meta)
    QualityGateCard.tsx                   — quality gate checklist
    PostDetailsCard.tsx                   — post details sidebar card
    GuidanceAppliedCard.tsx              — coaching insights sidebar card
    RuleSection.tsx                       — accordion section for rules
    RuleItem.tsx                          — individual rule with hover edit/delete
    CoachingChangeCard.tsx               — NEW/UPDATED/RETIRE card
    SubTabBar.tsx                         — Generate/Rules/History sub-tabs
```

### Component Tree

```
App.tsx
  └─ Generate.tsx (sub-tab state: "generate" | "rules" | "history")
       ├─ SubTabBar
       ├─ [generate] Pipeline (step state: 1 | 2 | 3)
       │    ├─ StorySelection (step 1)
       │    │    ├─ PostTypePills
       │    │    ├─ StoryCard ×3
       │    │    └─ BottomBar
       │    ├─ DraftVariations (step 2)
       │    │    ├─ DraftSidebar
       │    │    │    └─ DraftItem ×3 (badge + title + toggle)
       │    │    ├─ DraftReader
       │    │    └─ BottomBar (count badge + action)
       │    └─ ReviewEdit (step 3)
       │         ├─ EditorPanel (textarea + action buttons + instruction input)
       │         ├─ Sidebar
       │         │    ├─ QualityGateCard
       │         │    ├─ PostDetailsCard
       │         │    └─ GuidanceAppliedCard
       │         └─ BottomBar
       ├─ [rules] Rules
       │    └─ RuleSection ×3 (accordion)
       │         └─ RuleItem ×N + AddRuleInput
       ├─ [history] GenerationHistory
       │    ├─ FilterPills
       │    └─ HistoryTable
       └─ CoachingSyncModal (overlays everything when triggered)
            └─ CoachingChangeCard ×2 per page
```

### State Management
- Pipeline step: `useState<1 | 2 | 3>(1)` in Generate.tsx
- Sub-tab: `useState<"generate" | "rules" | "history">("generate")` in Generate.tsx
- Generation data flows through steps via `useState<GenerationState>` holding research_id, generation_id, stories, drafts, final_draft, quality_gate
- No global state library needed — data is local to the generation session

---

## Server Module Structure

### New Files

```
server/src/routes/generate.ts             — all /api/generate/* route handlers
server/src/ai/researcher.ts               — external source fetching + story curation
server/src/ai/drafter.ts                  — draft generation (3 variations)
server/src/ai/combiner.ts                 — draft combining logic
server/src/ai/quality-gate.ts             — quality assessment against rules/insights
server/src/ai/coaching-analyzer.ts        — weekly sync analysis
server/src/ai/prompt-assembler.ts         — 3-layer prompt assembly + token budget
server/src/db/generate-queries.ts         — all generation-related DB queries
server/src/db/migrations/009-generation.sql
```

### Prompt Assembler (`prompt-assembler.ts`)

```typescript
interface AssembledPrompt {
  system: string;
  token_count: number;
  layers: {
    rules: number;      // tokens used
    coaching: number;
    post_type: number;
  };
}

function assemblePrompt(
  db: Database,
  postType: "news" | "topic" | "insight",
  storyContext: string
): AssembledPrompt
```

Assembles the 3 layers in order, enforces 2,000 token cap, truncates coaching insights (lowest confidence first) if over budget.

### Researcher (`researcher.ts`)

```typescript
interface ResearchResult {
  stories: Story[];
  article_count: number;
  source_count: number;
  sources_metadata: SourceMeta[];
}

async function researchStories(
  client: AnthropicClient,
  db: Database,
  postType: string
): Promise<ResearchResult>
```

Fetches from configured sources, applies diversity scoring against recent generations (last 10 in `generations` table), ensures 1 stretch story, ranks by practitioner relevance.

### Quality Gate (`quality-gate.ts`)

```typescript
interface QualityGate {
  passed: boolean;
  checks: QualityCheck[];
}

interface QualityCheck {
  name: "voice_match" | "ai_tropes" | "hook_strength" | "engagement_close";
  status: "pass" | "warn";
  detail: string;
}

async function runQualityGate(
  client: AnthropicClient,
  draft: string,
  rules: GenerationRule[],
  insights: CoachingInsight[]
): Promise<QualityGate>
```

---

## AI Model Usage

| Step | Model | Reason |
|------|-------|--------|
| Research / story curation | Sonnet | Fast, good at summarization |
| Draft generation (3 variations) | Sonnet | Creative writing, needs to follow prompt layers |
| Draft combining | Sonnet | Merging + following guidance |
| Quality gate assessment | Sonnet | Evaluation against rules |
| Coaching sync analysis | Sonnet | Prompt review + conflict detection |
| Revisions (shorten/strengthen/custom) | Sonnet | Quick editing tasks |

All calls go through existing `server/src/ai/client.ts` with cost tracking.

---

## Out of Scope

- External source OAuth (HN/Twitter fetch uses public APIs / scraping)
- Scheduling posts directly to LinkedIn (copy + open is the interface)
- v2 performance-based retirement of coaching insights
- Auto-publish without review
- Image/carousel generation (text posts only for v1)

## Testing

- Pipeline flow: verify each step transitions correctly and data persists across steps
- Prompt assembly: verify token budget is respected, layers are in correct order
- Quality gate: verify anti-AI trope rules produce warnings on known-bad drafts
- Rules CRUD: add/edit/delete rules, verify they appear in next generation's prompt
- Coaching sync: accept a new insight, verify it appears in assembled prompt
- History: generate a post, verify it appears in history with correct status
- Diversity scoring: generate 5+ posts in same topic, verify stretch stories increase
- Fuzzy match: copy a generated post, scrape it back, verify status changes to 'published'
- Golden set regression: change a rule, verify golden set regeneration runs
