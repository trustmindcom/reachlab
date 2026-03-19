# Post Generation — Server Implementation Plan (Part 1 of 2)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side infrastructure for the post generation pipeline: database schema, AI modules, and API routes.

**Architecture:** New migration adds 10 tables. AI pipeline modules handle research, drafting, combining, quality gating, and coaching analysis. All endpoints registered under `/api/generate/` prefix. Prompt assembler enforces 3-layer architecture with token budget.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Anthropic SDK via OpenRouter, vitest

**Depends on:** Nothing (standalone)
**Consumed by:** Part 2 (Dashboard)

---

## File Structure

- **Create:** `server/src/db/migrations/009-generation.sql` — 10 new tables
- **Create:** `server/src/db/generate-queries.ts` — DB helpers for all generation tables
- **Create:** `server/src/ai/prompt-assembler.ts` — 3-layer prompt assembly with token budget
- **Create:** `server/src/ai/researcher.ts` — story research pipeline
- **Create:** `server/src/ai/drafter.ts` — 3-variation draft generation
- **Create:** `server/src/ai/combiner.ts` — draft combining with guidance
- **Create:** `server/src/ai/quality-gate.ts` — quality assessment against rules/insights
- **Create:** `server/src/ai/coaching-analyzer.ts` — weekly coaching sync analysis
- **Create:** `server/src/routes/generate.ts` — all `/api/generate/*` route handlers
- **Create:** `server/src/__tests__/generate-queries.test.ts` — DB query tests
- **Create:** `server/src/__tests__/prompt-assembler.test.ts` — prompt assembly tests
- **Create:** `server/src/__tests__/ai-pipeline-modules.test.ts` — AI module tests
- **Create:** `server/src/__tests__/generate-routes.test.ts` — route integration tests
- **Modify:** `server/src/app.ts` — register generate routes

---

## Chunk 1: Database & Core Infrastructure

### Task 1: Create migration 009-generation.sql

**Files:**
- Create: `server/src/db/migrations/009-generation.sql`

- [ ] **Step 1: Write the migration file**

Create `server/src/db/migrations/009-generation.sql` with the full schema from the design spec:

```sql
-- Migration 009: Post generation tables
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
  matched_post_id TEXT REFERENCES posts(id),
  prompt_snapshot TEXT,               -- full assembled prompt used
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
  decision TEXT,                      -- 'accept' | 'skip' | 'keep' | 'retire'
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

- [ ] **Step 2: Verify the migration applies**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors (migration is just SQL, but verify nothing else broke)

- [ ] **Step 3: Commit**

```bash
git add server/src/db/migrations/009-generation.sql
git commit -m "feat: add migration 009 with post generation tables"
```

### Task 2: Create generate-queries.ts — DB helper functions

**Files:**
- Create: `server/src/db/generate-queries.ts`

- [ ] **Step 1: Write the DB query helpers**

Create `server/src/db/generate-queries.ts`:

```typescript
import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────

export interface GenerationRule {
  id: number;
  category: string;
  rule_text: string;
  example_text: string | null;
  sort_order: number;
  enabled: number;
}

export interface CoachingInsight {
  id: number;
  title: string;
  prompt_text: string;
  evidence: string | null;
  status: string;
  source_sync_id: number | null;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
}

export interface PostTypeTemplate {
  id: number;
  post_type: string;
  template_text: string;
}

export interface Story {
  headline: string;
  summary: string;
  source: string;
  age: string;
  tag: string;
  angles: string[];
  is_stretch: boolean;
}

export interface Draft {
  type: "contrarian" | "operator" | "future";
  hook: string;
  body: string;
  closing: string;
  word_count: number;
  structure_label: string;
}

export interface QualityCheck {
  name: string;
  status: "pass" | "warn";
  detail: string;
}

export interface QualityGate {
  passed: boolean;
  checks: QualityCheck[];
}

export interface GenerationRecord {
  id: number;
  research_id: number | null;
  post_type: string;
  selected_story_index: number | null;
  drafts_json: string | null;
  selected_draft_indices: string | null;
  combining_guidance: string | null;
  final_draft: string | null;
  quality_gate_json: string | null;
  status: string;
  matched_post_id: string | null;
  prompt_snapshot: string | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cost_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface CoachingChange {
  id: number;
  sync_id: number;
  insight_id: number | null;
  change_type: string;
  old_text: string | null;
  new_text: string | null;
  evidence: string | null;
  decision: string | null;
  decided_at: string | null;
}

// ── Rules ──────────────────────────────────────────────────

export function getRules(db: Database.Database): GenerationRule[] {
  return db
    .prepare("SELECT * FROM generation_rules ORDER BY category, sort_order")
    .all() as GenerationRule[];
}

export function getRulesByCategory(
  db: Database.Database,
  category: string
): GenerationRule[] {
  return db
    .prepare("SELECT * FROM generation_rules WHERE category = ? ORDER BY sort_order")
    .all(category) as GenerationRule[];
}

export function replaceAllRules(
  db: Database.Database,
  rules: Array<{ category: string; rule_text: string; example_text?: string; sort_order: number; enabled?: number }>
): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM generation_rules").run();
    const insert = db.prepare(
      "INSERT INTO generation_rules (category, rule_text, example_text, sort_order, enabled) VALUES (?, ?, ?, ?, ?)"
    );
    for (const rule of rules) {
      insert.run(rule.category, rule.rule_text, rule.example_text ?? null, rule.sort_order, rule.enabled ?? 1);
    }
  });
  tx();
}

export function getAntiAiTropesEnabled(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT enabled FROM generation_rules WHERE category = 'anti_ai_tropes' LIMIT 1")
    .get() as { enabled: number } | undefined;
  return row ? row.enabled === 1 : true;
}

// ── Coaching Insights ──────────────────────────────────────

export function getActiveCoachingInsights(db: Database.Database): CoachingInsight[] {
  return db
    .prepare("SELECT * FROM coaching_insights WHERE status = 'active' ORDER BY created_at")
    .all() as CoachingInsight[];
}

export function getAllCoachingInsights(db: Database.Database): CoachingInsight[] {
  return db
    .prepare("SELECT * FROM coaching_insights ORDER BY created_at DESC")
    .all() as CoachingInsight[];
}

export function insertCoachingInsight(
  db: Database.Database,
  insight: { title: string; prompt_text: string; evidence?: string; source_sync_id?: number }
): number {
  const result = db
    .prepare(
      "INSERT INTO coaching_insights (title, prompt_text, evidence, source_sync_id) VALUES (?, ?, ?, ?)"
    )
    .run(insight.title, insight.prompt_text, insight.evidence ?? null, insight.source_sync_id ?? null);
  return Number(result.lastInsertRowid);
}

export function updateCoachingInsight(
  db: Database.Database,
  id: number,
  updates: { prompt_text?: string; status?: string; retired_at?: string }
): void {
  const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const params: any[] = [];
  if (updates.prompt_text !== undefined) {
    sets.push("prompt_text = ?");
    params.push(updates.prompt_text);
  }
  if (updates.status !== undefined) {
    sets.push("status = ?");
    params.push(updates.status);
  }
  if (updates.retired_at !== undefined) {
    sets.push("retired_at = ?");
    params.push(updates.retired_at);
  }
  params.push(id);
  db.prepare(`UPDATE coaching_insights SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

// ── Post Type Templates ────────────────────────────────────

export function getPostTypeTemplate(
  db: Database.Database,
  postType: string
): PostTypeTemplate | undefined {
  return db
    .prepare("SELECT * FROM post_type_templates WHERE post_type = ?")
    .get(postType) as PostTypeTemplate | undefined;
}

// ── Research ───────────────────────────────────────────────

export function insertResearch(
  db: Database.Database,
  data: { post_type: string; stories_json: string; sources_json?: string; article_count?: number; source_count?: number }
): number {
  const result = db
    .prepare(
      "INSERT INTO generation_research (post_type, stories_json, sources_json, article_count, source_count) VALUES (?, ?, ?, ?, ?)"
    )
    .run(data.post_type, data.stories_json, data.sources_json ?? null, data.article_count ?? null, data.source_count ?? null);
  return Number(result.lastInsertRowid);
}

export function getResearch(
  db: Database.Database,
  id: number
): { id: number; post_type: string; stories_json: string; sources_json: string | null; article_count: number; source_count: number } | undefined {
  return db
    .prepare("SELECT * FROM generation_research WHERE id = ?")
    .get(id) as any;
}

// ── Generations ────────────────────────────────────────────

export function insertGeneration(
  db: Database.Database,
  data: {
    research_id: number;
    post_type: string;
    selected_story_index: number;
    drafts_json: string;
    prompt_snapshot?: string;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO generations (research_id, post_type, selected_story_index, drafts_json, prompt_snapshot)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(data.research_id, data.post_type, data.selected_story_index, data.drafts_json, data.prompt_snapshot ?? null);
  return Number(result.lastInsertRowid);
}

export function getGeneration(
  db: Database.Database,
  id: number
): GenerationRecord | undefined {
  return db
    .prepare("SELECT * FROM generations WHERE id = ?")
    .get(id) as GenerationRecord | undefined;
}

export function updateGeneration(
  db: Database.Database,
  id: number,
  updates: Partial<{
    selected_draft_indices: string;
    combining_guidance: string;
    final_draft: string;
    quality_gate_json: string;
    status: string;
    matched_post_id: string;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_cents: number;
  }>
): void {
  const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const params: any[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }
  params.push(id);
  db.prepare(`UPDATE generations SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function listGenerations(
  db: Database.Database,
  opts: { status?: string; offset?: number; limit?: number }
): { generations: GenerationRecord[]; total: number } {
  const where = opts.status && opts.status !== "all" ? "WHERE status = ?" : "";
  const params: any[] = opts.status && opts.status !== "all" ? [opts.status] : [];

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM generations ${where}`).get(...params) as { count: number }
  ).count;

  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const rows = db
    .prepare(`SELECT * FROM generations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as GenerationRecord[];

  return { generations: rows, total };
}

// ── Revisions ──────────────────────────────────────────────

export function insertRevision(
  db: Database.Database,
  data: {
    generation_id: number;
    action: string;
    instruction?: string;
    input_draft: string;
    output_draft: string;
    quality_gate_json?: string;
    input_tokens?: number;
    output_tokens?: number;
    cost_cents?: number;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO generation_revisions
       (generation_id, action, instruction, input_draft, output_draft, quality_gate_json, input_tokens, output_tokens, cost_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.generation_id,
      data.action,
      data.instruction ?? null,
      data.input_draft,
      data.output_draft,
      data.quality_gate_json ?? null,
      data.input_tokens ?? null,
      data.output_tokens ?? null,
      data.cost_cents ?? null
    );
  return Number(result.lastInsertRowid);
}

// ── Coaching Syncs ─────────────────────────────────────────

export function insertCoachingSync(
  db: Database.Database,
  changes_json: string
): number {
  const result = db
    .prepare("INSERT INTO coaching_syncs (changes_json) VALUES (?)")
    .run(changes_json);
  return Number(result.lastInsertRowid);
}

export function getCoachingSync(
  db: Database.Database,
  id: number
): { id: number; changes_json: string; decisions_json: string | null; accepted_count: number; skipped_count: number; status: string } | undefined {
  return db
    .prepare("SELECT * FROM coaching_syncs WHERE id = ?")
    .get(id) as any;
}

export function completeCoachingSync(
  db: Database.Database,
  id: number,
  decisions_json: string,
  accepted: number,
  skipped: number
): void {
  db.prepare(
    `UPDATE coaching_syncs SET status = 'completed', decisions_json = ?, accepted_count = ?, skipped_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(decisions_json, accepted, skipped, id);
}

// ── Coaching Change Log ────────────────────────────────────

export function insertCoachingChangeLog(
  db: Database.Database,
  data: {
    sync_id: number;
    insight_id?: number;
    change_type: string;
    old_text?: string;
    new_text?: string;
    evidence?: string;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO coaching_change_log (sync_id, insight_id, change_type, old_text, new_text, evidence)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(data.sync_id, data.insight_id ?? null, data.change_type, data.old_text ?? null, data.new_text ?? null, data.evidence ?? null);
  return Number(result.lastInsertRowid);
}

export function updateCoachingChangeDecision(
  db: Database.Database,
  id: number,
  decision: string
): void {
  db.prepare(
    "UPDATE coaching_change_log SET decision = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(decision, id);
}

export function getCoachingChangeLog(
  db: Database.Database,
  syncId: number
): CoachingChange[] {
  return db
    .prepare("SELECT * FROM coaching_change_log WHERE sync_id = ? ORDER BY id")
    .all(syncId) as CoachingChange[];
}

export function getCoachingSyncHistory(
  db: Database.Database
): Array<{ id: number; accepted_count: number; skipped_count: number; status: string; created_at: string; completed_at: string | null }> {
  return db
    .prepare("SELECT id, accepted_count, skipped_count, status, created_at, completed_at FROM coaching_syncs ORDER BY id DESC LIMIT 20")
    .all() as any[];
}

// ── Topic Log ──────────────────────────────────────────────

export function insertTopicLog(
  db: Database.Database,
  data: { generation_id: number; topic_category?: string; was_stretch?: boolean }
): void {
  db.prepare(
    "INSERT INTO generation_topic_log (generation_id, topic_category, was_stretch) VALUES (?, ?, ?)"
  ).run(data.generation_id, data.topic_category ?? null, data.was_stretch ? 1 : 0);
}

export function getRecentTopics(
  db: Database.Database,
  limit: number = 10
): Array<{ topic_category: string; was_stretch: number; created_at: string }> {
  return db
    .prepare("SELECT topic_category, was_stretch, created_at FROM generation_topic_log ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[];
}

// ── Default Rules ──────────────────────────────────────────

export const DEFAULT_RULES: Array<{ category: string; rule_text: string; example_text?: string; sort_order: number }> = [
  // Voice & tone
  { category: "voice_tone", rule_text: "Write as a practitioner sharing hard-won experience, not a thought leader pontificating", sort_order: 0 },
  { category: "voice_tone", rule_text: "Favor concrete specifics over vague abstractions", example_text: "Favor: \"$400/month replacing $400k/year\" — Avoid: \"cost-effective solution\"", sort_order: 1 },
  { category: "voice_tone", rule_text: "Use embodied experience (\"I shipped\", \"We discovered\") not generic descriptions (\"Companies should\", \"Leaders must\")", sort_order: 2 },
  { category: "voice_tone", rule_text: "One idea per post. Resist the urge to cover everything", sort_order: 3 },
  { category: "voice_tone", rule_text: "Match conversational register — write like you'd explain it to a sharp colleague over coffee", sort_order: 4 },
  // Structure & formatting
  { category: "structure_formatting", rule_text: "Open with friction, a claim, or a surprising insight — never context, history, or a rhetorical question", sort_order: 0 },
  { category: "structure_formatting", rule_text: "Close with a question that invites informed disagreement or practitioner reflection, not a generic opinion poll", sort_order: 1 },
  { category: "structure_formatting", rule_text: "Keep paragraphs to 1-2 sentences. Use line breaks for rhythm", sort_order: 2 },
  { category: "structure_formatting", rule_text: "End by extending the idea forward, not summarizing or recapping what was already said", sort_order: 3 },
  { category: "structure_formatting", rule_text: "250-400 words. Shorter is better if the idea is complete", sort_order: 4 },
  // Anti-AI tropes
  { category: "anti_ai_tropes", rule_text: "No hedging words: \"actually\", \"just\", \"maybe\", \"perhaps\", \"honestly\"", sort_order: 0 },
  { category: "anti_ai_tropes", rule_text: "No correlative filler: \"Not X, but Y\" / \"It's not about X, it's about Y\" constructions", sort_order: 1 },
  { category: "anti_ai_tropes", rule_text: "No rhetorical questions as filler or transitions", sort_order: 2 },
  { category: "anti_ai_tropes", rule_text: "No meandering intros that set context before getting to the point", sort_order: 3 },
  { category: "anti_ai_tropes", rule_text: "No recapping conclusions that summarize what was already said", sort_order: 4 },
  { category: "anti_ai_tropes", rule_text: "No emoji as bullet points or section markers", sort_order: 5 },
  { category: "anti_ai_tropes", rule_text: "No \"Here's the thing\" / \"Let me tell you\" / \"The truth is\" throat-clearing", sort_order: 6 },
  { category: "anti_ai_tropes", rule_text: "No abstract industry analysis without personal stakes or direct experience", sort_order: 7 },
];

export function seedDefaultRules(db: Database.Database): void {
  replaceAllRules(db, DEFAULT_RULES);
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/db/generate-queries.ts
git commit -m "feat: add generate-queries.ts with DB helpers for all generation tables"
```

### Task 3: Create prompt-assembler.ts

**Files:**
- Create: `server/src/ai/prompt-assembler.ts`

- [ ] **Step 1: Write the prompt assembler**

Create `server/src/ai/prompt-assembler.ts`:

```typescript
import type Database from "better-sqlite3";
import {
  getRules,
  getActiveCoachingInsights,
  getPostTypeTemplate,
  type GenerationRule,
  type CoachingInsight,
} from "../db/generate-queries.js";

export interface AssembledPrompt {
  system: string;
  token_count: number;
  layers: {
    rules: number;
    coaching: number;
    post_type: number;
  };
}

// Rough token estimate: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const TOKEN_BUDGET = 2000;

function formatRulesLayer(rules: GenerationRule[]): string {
  const categories: Record<string, GenerationRule[]> = {};
  for (const rule of rules) {
    if (!categories[rule.category]) categories[rule.category] = [];
    categories[rule.category].push(rule);
  }

  const sections: string[] = [];
  const categoryLabels: Record<string, string> = {
    voice_tone: "Voice & Tone",
    structure_formatting: "Structure & Formatting",
    anti_ai_tropes: "Anti-AI Tropes",
  };

  for (const [cat, catRules] of Object.entries(categories)) {
    // Skip disabled anti-AI tropes
    if (cat === "anti_ai_tropes" && catRules.every((r) => !r.enabled)) continue;
    const activeRules = catRules.filter((r) => r.enabled);
    if (activeRules.length === 0) continue;

    const label = categoryLabels[cat] ?? cat;
    const lines = activeRules.map((r) => {
      let line = `- ${r.rule_text}`;
      if (r.example_text) line += `\n  (${r.example_text})`;
      return line;
    });
    sections.push(`### ${label}\n${lines.join("\n")}`);
  }

  return sections.length > 0 ? `## Writing Rules\n\n${sections.join("\n\n")}` : "";
}

function formatCoachingLayer(insights: CoachingInsight[]): string {
  if (insights.length === 0) return "";
  const lines = insights.map((i) => `- **${i.title}**: ${i.prompt_text}`);
  return `## Coaching Insights\n\n${lines.join("\n")}`;
}

function formatPostTypeLayer(template: string, postType: string): string {
  const labels: Record<string, string> = {
    news: "News Reaction",
    topic: "Topic Exploration",
    insight: "Professional Insight",
  };
  return `## Post Type: ${labels[postType] ?? postType}\n\n${template}`;
}

export function assemblePrompt(
  db: Database.Database,
  postType: "news" | "topic" | "insight",
  storyContext: string
): AssembledPrompt {
  const rules = getRules(db);
  const insights = getActiveCoachingInsights(db);
  const template = getPostTypeTemplate(db, postType);

  const rulesText = formatRulesLayer(rules);
  const coachingText = formatCoachingLayer(insights);
  const postTypeText = template
    ? formatPostTypeLayer(template.template_text, postType)
    : "";

  let rulesTokens = estimateTokens(rulesText);
  let coachingTokens = estimateTokens(coachingText);
  const postTypeTokens = estimateTokens(postTypeText);

  // If over budget, truncate coaching insights (lowest confidence first — here just trim from end)
  const layerTotal = rulesTokens + coachingTokens + postTypeTokens;
  let finalCoachingText = coachingText;
  if (layerTotal > TOKEN_BUDGET && insights.length > 0) {
    const available = TOKEN_BUDGET - rulesTokens - postTypeTokens;
    if (available > 0) {
      // Progressively remove insights from the end until under budget
      let trimmedInsights = [...insights];
      while (estimateTokens(formatCoachingLayer(trimmedInsights)) > available && trimmedInsights.length > 0) {
        trimmedInsights.pop();
      }
      finalCoachingText = formatCoachingLayer(trimmedInsights);
      coachingTokens = estimateTokens(finalCoachingText);
    } else {
      finalCoachingText = "";
      coachingTokens = 0;
    }
  }

  const system = [
    "You are a LinkedIn post ghostwriter.",
    "",
    rulesText,
    "",
    finalCoachingText,
    "",
    postTypeText,
    "",
    storyContext ? `## Story Context\n\n${storyContext}` : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");

  return {
    system,
    token_count: estimateTokens(system),
    layers: {
      rules: rulesTokens,
      coaching: coachingTokens,
      post_type: postTypeTokens,
    },
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/prompt-assembler.ts
git commit -m "feat: add prompt-assembler.ts with 3-layer architecture and token budget"
```

### Task 4: Write tests for DB queries and prompt assembler

**Files:**
- Create: `server/src/__tests__/generate-queries.test.ts`
- Create: `server/src/__tests__/prompt-assembler.test.ts`

- [ ] **Step 1: Write DB query tests**

Create `server/src/__tests__/generate-queries.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import {
  getRules,
  replaceAllRules,
  seedDefaultRules,
  getActiveCoachingInsights,
  insertCoachingInsight,
  updateCoachingInsight,
  insertResearch,
  getResearch,
  insertGeneration,
  getGeneration,
  updateGeneration,
  listGenerations,
  insertRevision,
  insertCoachingSync,
  getCoachingSync,
  insertCoachingChangeLog,
  updateCoachingChangeDecision,
  getCoachingChangeLog,
  insertTopicLog,
  getRecentTopics,
  getPostTypeTemplate,
  DEFAULT_RULES,
} from "../db/generate-queries.js";
import { initDatabase } from "../db/index.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-generate-queries.db");

let db: ReturnType<typeof initDatabase>;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("generation_rules", () => {
  it("seeds default rules", () => {
    seedDefaultRules(db);
    const rules = getRules(db);
    expect(rules.length).toBe(DEFAULT_RULES.length);
    expect(rules[0].category).toBe("voice_tone");
  });

  it("replaces all rules", () => {
    replaceAllRules(db, [
      { category: "voice_tone", rule_text: "Test rule", sort_order: 0 },
    ]);
    const rules = getRules(db);
    expect(rules.length).toBe(1);
    expect(rules[0].rule_text).toBe("Test rule");
  });
});

describe("coaching_insights", () => {
  it("inserts and retrieves active insights", () => {
    const id = insertCoachingInsight(db, {
      title: "Hook patterns",
      prompt_text: "Use contrarian hooks for higher engagement",
      evidence: "Top 5 posts all use contrarian hooks",
    });
    expect(id).toBeGreaterThan(0);

    const insights = getActiveCoachingInsights(db);
    expect(insights.length).toBe(1);
    expect(insights[0].title).toBe("Hook patterns");
  });

  it("updates insight status", () => {
    const insights = getActiveCoachingInsights(db);
    updateCoachingInsight(db, insights[0].id, { status: "retired", retired_at: new Date().toISOString() });
    const active = getActiveCoachingInsights(db);
    expect(active.length).toBe(0);
  });
});

describe("post_type_templates", () => {
  it("returns seeded templates", () => {
    const tpl = getPostTypeTemplate(db, "news");
    expect(tpl).toBeDefined();
    expect(tpl!.template_text).toContain("news story");
  });

  it("returns undefined for unknown type", () => {
    const tpl = getPostTypeTemplate(db, "nonexistent");
    expect(tpl).toBeUndefined();
  });
});

describe("generation_research", () => {
  it("inserts and retrieves research", () => {
    const id = insertResearch(db, {
      post_type: "news",
      stories_json: JSON.stringify([{ headline: "Test" }]),
      article_count: 5,
      source_count: 2,
    });
    const research = getResearch(db, id);
    expect(research).toBeDefined();
    expect(research!.post_type).toBe("news");
    expect(JSON.parse(research!.stories_json)).toHaveLength(1);
  });
});

describe("generations", () => {
  let genId: number;

  it("inserts a generation", () => {
    const researchId = insertResearch(db, {
      post_type: "topic",
      stories_json: JSON.stringify([]),
    });
    genId = insertGeneration(db, {
      research_id: researchId,
      post_type: "topic",
      selected_story_index: 0,
      drafts_json: JSON.stringify([{ type: "contrarian", hook: "Test" }]),
    });
    expect(genId).toBeGreaterThan(0);
  });

  it("updates generation fields", () => {
    updateGeneration(db, genId, {
      final_draft: "The final post text",
      status: "copied",
    });
    const gen = getGeneration(db, genId);
    expect(gen!.final_draft).toBe("The final post text");
    expect(gen!.status).toBe("copied");
  });

  it("lists generations with pagination", () => {
    const result = listGenerations(db, { limit: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.generations.length).toBeGreaterThan(0);
  });

  it("filters generations by status", () => {
    const result = listGenerations(db, { status: "copied" });
    expect(result.generations.every((g) => g.status === "copied")).toBe(true);
  });
});

describe("generation_revisions", () => {
  it("inserts a revision", () => {
    const researchId = insertResearch(db, { post_type: "news", stories_json: "[]" });
    const genId = insertGeneration(db, {
      research_id: researchId,
      post_type: "news",
      selected_story_index: 0,
      drafts_json: "[]",
    });
    const revId = insertRevision(db, {
      generation_id: genId,
      action: "shorten",
      input_draft: "Long draft",
      output_draft: "Short draft",
    });
    expect(revId).toBeGreaterThan(0);
  });
});

describe("coaching_syncs", () => {
  it("inserts and retrieves a sync", () => {
    const syncId = insertCoachingSync(db, JSON.stringify([{ type: "new" }]));
    const sync = getCoachingSync(db, syncId);
    expect(sync).toBeDefined();
    expect(sync!.status).toBe("pending");
  });
});

describe("coaching_change_log", () => {
  it("inserts changes and updates decisions", () => {
    const syncId = insertCoachingSync(db, "[]");
    const changeId = insertCoachingChangeLog(db, {
      sync_id: syncId,
      change_type: "new",
      new_text: "New insight text",
      evidence: "Data shows X",
    });
    updateCoachingChangeDecision(db, changeId, "accept");
    const changes = getCoachingChangeLog(db, syncId);
    expect(changes.length).toBe(1);
    expect(changes[0].decision).toBe("accept");
  });
});

describe("generation_topic_log", () => {
  it("tracks topic selections", () => {
    const researchId = insertResearch(db, { post_type: "news", stories_json: "[]" });
    const genId = insertGeneration(db, {
      research_id: researchId,
      post_type: "news",
      selected_story_index: 0,
      drafts_json: "[]",
    });
    insertTopicLog(db, { generation_id: genId, topic_category: "AI", was_stretch: false });
    insertTopicLog(db, { generation_id: genId, topic_category: "Finance", was_stretch: true });
    const topics = getRecentTopics(db, 5);
    expect(topics.length).toBe(2);
    expect(topics[0].topic_category).toBe("Finance");
  });
});
```

- [ ] **Step 2: Run the DB query tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/generate-queries.test.ts 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 3: Write prompt assembler tests**

Create `server/src/__tests__/prompt-assembler.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { initDatabase } from "../db/index.js";
import { assemblePrompt } from "../ai/prompt-assembler.js";
import {
  seedDefaultRules,
  insertCoachingInsight,
} from "../db/generate-queries.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-prompt-assembler.db");

let db: ReturnType<typeof initDatabase>;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
  seedDefaultRules(db);
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("assemblePrompt", () => {
  it("includes all 3 layers for news post type", () => {
    const result = assemblePrompt(db, "news", "Breaking: AI costs drop 90%");
    expect(result.system).toContain("Writing Rules");
    expect(result.system).toContain("Post Type: News Reaction");
    expect(result.system).toContain("Story Context");
    expect(result.system).toContain("AI costs drop 90%");
    expect(result.token_count).toBeGreaterThan(0);
    expect(result.layers.rules).toBeGreaterThan(0);
    expect(result.layers.post_type).toBeGreaterThan(0);
  });

  it("includes coaching insights when present", () => {
    insertCoachingInsight(db, {
      title: "Contrarian hooks",
      prompt_text: "Lead with a take that challenges conventional wisdom",
    });
    const result = assemblePrompt(db, "topic", "");
    expect(result.system).toContain("Coaching Insights");
    expect(result.system).toContain("Contrarian hooks");
    expect(result.layers.coaching).toBeGreaterThan(0);
  });

  it("respects token budget by trimming coaching insights", () => {
    // Add many coaching insights to push over budget
    for (let i = 0; i < 20; i++) {
      insertCoachingInsight(db, {
        title: `Insight ${i}`,
        prompt_text: "A".repeat(200), // ~50 tokens each
      });
    }
    const result = assemblePrompt(db, "news", "story");
    expect(result.token_count).toBeLessThanOrEqual(2200); // allow some flex for structure
  });

  it("returns empty coaching when no insights exist", () => {
    // Use a fresh DB for isolation
    const freshPath = path.join(import.meta.dirname, "../../data/test-prompt-assembler-fresh.db");
    const freshDb = initDatabase(freshPath);
    seedDefaultRules(freshDb);

    const result = assemblePrompt(freshDb, "insight", "My story");
    expect(result.system).not.toContain("Coaching Insights");
    expect(result.layers.coaching).toBe(0);

    freshDb.close();
    try { fs.unlinkSync(freshPath); fs.unlinkSync(freshPath + "-wal"); fs.unlinkSync(freshPath + "-shm"); } catch {}
  });

  it("handles all post types", () => {
    for (const postType of ["news", "topic", "insight"] as const) {
      const result = assemblePrompt(db, postType, "context");
      expect(result.system).toContain("Post Type:");
    }
  });
});
```

- [ ] **Step 4: Run the prompt assembler tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/prompt-assembler.test.ts 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/__tests__/generate-queries.test.ts server/src/__tests__/prompt-assembler.test.ts
git commit -m "test: add generate-queries and prompt-assembler unit tests"
```

---

## Chunk 2: AI Pipeline Modules

### Task 5: Create researcher.ts

**Files:**
- Create: `server/src/ai/researcher.ts`

- [ ] **Step 1: Write the researcher module**

Create `server/src/ai/researcher.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import { getRecentTopics, type Story } from "../db/generate-queries.js";

export interface ResearchResult {
  stories: Story[];
  article_count: number;
  source_count: number;
  sources_metadata: Array<{ name: string; url?: string }>;
}

/**
 * Research stories for a given post type.
 * Currently uses LLM to generate story ideas based on the post type and
 * recent topic history (to ensure diversity). External source fetching
 * (HN, Twitter, niche feeds) is stubbed for v1.
 */
export async function researchStories(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger,
  postType: string
): Promise<ResearchResult> {
  const recentTopics = getRecentTopics(db, 10);
  const recentCategories = recentTopics.map((t) => t.topic_category).filter(Boolean);

  const avoidTopics =
    recentCategories.length > 0
      ? `\n\nAvoid these recently-covered topics: ${[...new Set(recentCategories)].join(", ")}`
      : "";

  const typePrompts: Record<string, string> = {
    news: "Generate 3 compelling news story angles that a tech/business practitioner could write a LinkedIn post about. Stories should be timely, opinionated, and invite practitioner perspective.",
    topic: "Generate 3 professional topic ideas that a practitioner could write a strong LinkedIn post about. Topics should be specific enough to have a sharp take, not broad industry themes.",
    insight: "Generate 3 hard-won professional insight ideas that would make compelling LinkedIn posts. Each should center on a specific lesson learned through direct experience.",
  };

  const prompt = (typePrompts[postType] ?? typePrompts.topic) + avoidTopics;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 1500,
    system: "You generate story/topic ideas for LinkedIn posts. Always return valid JSON.",
    messages: [
      {
        role: "user",
        content: `${prompt}

The 3rd story MUST be a "stretch" — from an adjacent but different domain to encourage creative range.

Return JSON:
{
  "stories": [
    {
      "headline": "string — newsreader-style headline",
      "summary": "string — 2-3 sentence summary",
      "source": "string — e.g. 'Industry trend', 'Recent news', 'Practitioner observation'",
      "age": "string — e.g. 'This week', 'Emerging'",
      "tag": "string — topic category",
      "angles": ["string — possible angle 1", "string — possible angle 2"],
      "is_stretch": false
    }
  ]
}

Set is_stretch: true for the 3rd story only.`,
      },
    ],
  });

  const duration = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: "research",
    model: MODELS.SONNET,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  // Parse the JSON response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Research response did not contain valid JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]) as { stories: Story[] };

  return {
    stories: parsed.stories.slice(0, 3),
    article_count: parsed.stories.length,
    source_count: 1, // LLM-generated for v1
    sources_metadata: [{ name: "AI-generated story ideas" }],
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/researcher.ts
git commit -m "feat: add researcher.ts for story research pipeline"
```

### Task 6: Create drafter.ts

**Files:**
- Create: `server/src/ai/drafter.ts`

- [ ] **Step 1: Write the drafter module**

Create `server/src/ai/drafter.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import { assemblePrompt } from "./prompt-assembler.js";
import type { Story, Draft } from "../db/generate-queries.js";

export interface DraftResult {
  drafts: Draft[];
  prompt_snapshot: string;
  input_tokens: number;
  output_tokens: number;
}

const VARIATION_INSTRUCTIONS: Record<string, string> = {
  contrarian:
    "Write a CONTRARIAN variation. Challenge the obvious take. Lead with what most people get wrong about this topic. Be specific about why the conventional wisdom fails.",
  operator:
    "Write an OPERATOR variation. Ground everything in direct, hands-on experience. Use specific numbers, tools, timelines. Write as someone who has done the work, not observed it.",
  future:
    "Write a FUTURE-FACING variation. Extrapolate from this story to what it means 2-5 years out. Make a specific prediction grounded in the current evidence. Be bold but defensible.",
};

/**
 * Generate 3 draft variations (contrarian, operator, future-facing) for a selected story.
 */
export async function generateDrafts(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger,
  postType: "news" | "topic" | "insight",
  story: Story
): Promise<DraftResult> {
  const storyContext = `**${story.headline}**\n${story.summary}\nSource: ${story.source} | ${story.age}\nPossible angles: ${story.angles.join("; ")}`;
  const assembled = assemblePrompt(db, postType, storyContext);

  let totalInput = 0;
  let totalOutput = 0;
  const drafts: Draft[] = [];

  for (const [variationType, instruction] of Object.entries(VARIATION_INSTRUCTIONS)) {
    const start = Date.now();
    const response = await client.messages.create({
      model: MODELS.SONNET,
      max_tokens: 2000,
      system: assembled.system,
      messages: [
        {
          role: "user",
          content: `${instruction}

Return JSON:
{
  "hook": "string — the opening 1-2 sentences that stop the scroll",
  "body": "string — the main content, use \\n for line breaks",
  "closing": "string — the closing question or reflection",
  "word_count": number,
  "structure_label": "string — brief description like 'Contrarian take with personal evidence'"
}`,
        },
      ],
    });

    const duration = Date.now() - start;
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    logger.log({
      step: `draft_${variationType}`,
      model: MODELS.SONNET,
      input_messages: JSON.stringify([{ role: "user", content: instruction }]),
      output_text: text,
      tool_calls: null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: 0,
      duration_ms: duration,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Draft ${variationType} response did not contain valid JSON`);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    drafts.push({
      type: variationType as Draft["type"],
      hook: parsed.hook,
      body: parsed.body,
      closing: parsed.closing,
      word_count: parsed.word_count ?? 0,
      structure_label: parsed.structure_label ?? variationType,
    });
  }

  return {
    drafts,
    prompt_snapshot: assembled.system,
    input_tokens: totalInput,
    output_tokens: totalOutput,
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/drafter.ts
git commit -m "feat: add drafter.ts for 3-variation draft generation"
```

### Task 7: Create combiner.ts

**Files:**
- Create: `server/src/ai/combiner.ts`

- [ ] **Step 1: Write the combiner module**

Create `server/src/ai/combiner.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import type { Draft } from "../db/generate-queries.js";

export interface CombineResult {
  final_draft: string;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Combine 2+ selected drafts into a single final draft using optional guidance.
 * If only 1 draft is selected, returns it as-is (formatted as full text).
 */
export async function combineDrafts(
  client: Anthropic,
  logger: AiLogger,
  drafts: Draft[],
  selectedIndices: number[],
  guidance?: string
): Promise<CombineResult> {
  const selected = selectedIndices.map((i) => drafts[i]).filter(Boolean);

  if (selected.length === 0) {
    throw new Error("No drafts selected for combining");
  }

  // Single draft — just format and return
  if (selected.length === 1) {
    const d = selected[0];
    const fullText = `${d.hook}\n\n${d.body}\n\n${d.closing}`;
    return { final_draft: fullText, input_tokens: 0, output_tokens: 0 };
  }

  // Multiple drafts — combine via LLM
  const draftsText = selected
    .map(
      (d, i) =>
        `--- Draft ${i + 1} (${d.type}) ---\nHook: ${d.hook}\n\nBody:\n${d.body}\n\nClosing: ${d.closing}`
    )
    .join("\n\n");

  const guidanceText = guidance
    ? `\n\nUser guidance for combining: "${guidance}"`
    : "";

  const prompt = `Combine these ${selected.length} LinkedIn post drafts into a single cohesive post. Take the strongest elements from each — the best hook, the most compelling evidence, the sharpest closing.${guidanceText}

${draftsText}

Return the combined post as plain text (no JSON, no markdown headers). Use line breaks between paragraphs.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const duration = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: "combine",
    model: MODELS.SONNET,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  return {
    final_draft: text.trim(),
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/combiner.ts
git commit -m "feat: add combiner.ts for draft combining with optional guidance"
```

### Task 8: Create quality-gate.ts

**Files:**
- Create: `server/src/ai/quality-gate.ts`

- [ ] **Step 1: Write the quality gate module**

Create `server/src/ai/quality-gate.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import type { GenerationRule, CoachingInsight, QualityGate, QualityCheck } from "../db/generate-queries.js";

/**
 * Run quality gate assessment on a final draft.
 * Checks against writing rules, coaching insights, and anti-AI tropes.
 */
export async function runQualityGate(
  client: Anthropic,
  logger: AiLogger,
  draft: string,
  rules: GenerationRule[],
  insights: CoachingInsight[]
): Promise<QualityGate> {
  const rulesText = rules.map((r) => `- [${r.category}] ${r.rule_text}`).join("\n");
  const insightsText = insights.map((i) => `- ${i.prompt_text}`).join("\n");

  const prompt = `Assess this LinkedIn post draft against the writing rules and coaching insights below.

## Draft
${draft}

## Writing Rules
${rulesText}

## Coaching Insights
${insightsText}

Check each of these quality dimensions and return JSON:
{
  "passed": boolean,  // true if no "warn" checks
  "checks": [
    {
      "name": "voice_match",
      "status": "pass" | "warn",
      "detail": "string — brief explanation"
    },
    {
      "name": "ai_tropes",
      "status": "pass" | "warn",
      "detail": "string — list any detected AI-isms"
    },
    {
      "name": "hook_strength",
      "status": "pass" | "warn",
      "detail": "string — does it open with friction/claim, not a question or context dump?"
    },
    {
      "name": "engagement_close",
      "status": "pass" | "warn",
      "detail": "string — process question vs opinion question"
    },
    {
      "name": "concrete_specifics",
      "status": "pass" | "warn",
      "detail": "string — uses named tools/metrics/experiences vs abstractions"
    },
    {
      "name": "ending_quality",
      "status": "pass" | "warn",
      "detail": "string — extends the idea vs summarizes/recaps"
    }
  ]
}

Be strict. If in doubt, mark as "warn" with specific advice.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 1000,
    system: "You are a quality assessment engine for LinkedIn posts. Return valid JSON only.",
    messages: [{ role: "user", content: prompt }],
  });

  const duration = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: "quality_gate",
    model: MODELS.SONNET,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: return a default pass if parsing fails
    return {
      passed: true,
      checks: [{ name: "parse_error", status: "warn", detail: "Quality gate response could not be parsed" }],
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as QualityGate;
  // Recalculate passed based on actual checks
  parsed.passed = parsed.checks.every((c) => c.status === "pass");
  return parsed;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/quality-gate.ts
git commit -m "feat: add quality-gate.ts for draft quality assessment"
```

### Task 9: Create coaching-analyzer.ts

**Files:**
- Create: `server/src/ai/coaching-analyzer.ts`

- [ ] **Step 1: Write the coaching analyzer module**

Create `server/src/ai/coaching-analyzer.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import {
  getRules,
  getActiveCoachingInsights,
  type CoachingInsight,
} from "../db/generate-queries.js";

export interface CoachingChangeProposal {
  type: "new" | "updated" | "retire";
  title: string;
  evidence: string;
  old_text?: string;
  new_text?: string;
  insight_id?: number;
}

export interface CoachingAnalysisResult {
  changes: CoachingChangeProposal[];
  input_tokens: number;
  output_tokens: number;
}

/**
 * Analyze the full prompt (rules + insights) and recent post performance
 * to propose coaching changes. Enforces incremental honing: max 20% change,
 * conflict detection, redundancy checks.
 */
export async function analyzeCoaching(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger
): Promise<CoachingAnalysisResult> {
  const rules = getRules(db);
  const insights = getActiveCoachingInsights(db);

  // Get recent generation performance for context
  const recentGens = db
    .prepare(
      `SELECT g.id, g.final_draft, g.quality_gate_json, g.status, g.created_at
       FROM generations g
       WHERE g.final_draft IS NOT NULL
       ORDER BY g.created_at DESC LIMIT 10`
    )
    .all() as Array<{ id: number; final_draft: string; quality_gate_json: string | null; status: string; created_at: string }>;

  const rulesText = rules.map((r) => `- [${r.category}] ${r.rule_text}`).join("\n");
  const insightsText = insights.length > 0
    ? insights.map((i) => `- [ID:${i.id}] "${i.title}": ${i.prompt_text}`).join("\n")
    : "(none yet)";
  const performanceText = recentGens.length > 0
    ? recentGens.map((g) => {
        const qg = g.quality_gate_json ? JSON.parse(g.quality_gate_json) : null;
        const warnings = qg?.checks?.filter((c: any) => c.status === "warn")?.length ?? 0;
        return `- Gen #${g.id} (${g.status}): ${warnings} quality warnings`;
      }).join("\n")
    : "(no recent generations)";

  const prompt = `You are a coaching system for a LinkedIn post ghostwriter. Review the current prompt configuration and recent performance to propose targeted improvements.

## Current Writing Rules
${rulesText}

## Current Coaching Insights (max 8 active)
${insightsText}

## Recent Generation Performance
${performanceText}

## Constraints
- Max 3 changes per sync
- Never rewrite > 20% of the total prompt
- Check for: redundancy between rules and insights, conflicting instructions, vague/unfalsifiable claims, token bloat
- New insights must not duplicate existing rules
- Consider retiring insights that are naturally followed (no longer needed as explicit instruction)

Propose changes as JSON:
{
  "changes": [
    {
      "type": "new" | "updated" | "retire",
      "title": "string — short label",
      "evidence": "string — why this change",
      "old_text": "string | null — for updated/retire, the current text",
      "new_text": "string | null — for new/updated, the proposed text",
      "insight_id": number | null — for updated/retire, the ID to modify
    }
  ]
}

Return at most 3 changes. If nothing needs changing, return {"changes": []}.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 1500,
    system: "You are a prompt coaching system. Return valid JSON only.",
    messages: [{ role: "user", content: prompt }],
  });

  const duration = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: "coaching_analyze",
    model: MODELS.SONNET,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { changes: [], input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
  }

  const parsed = JSON.parse(jsonMatch[0]) as { changes: CoachingChangeProposal[] };

  return {
    changes: parsed.changes.slice(0, 3),
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/coaching-analyzer.ts
git commit -m "feat: add coaching-analyzer.ts for weekly coaching sync analysis"
```

### Task 10: Write AI module tests

**Files:**
- Create: `server/src/__tests__/ai-pipeline-modules.test.ts`

- [ ] **Step 1: Write tests for all AI modules with mocked Anthropic client**

Create `server/src/__tests__/ai-pipeline-modules.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import { initDatabase } from "../db/index.js";
import { AiLogger } from "../ai/logger.js";
import { researchStories } from "../ai/researcher.js";
import { generateDrafts } from "../ai/drafter.js";
import { combineDrafts } from "../ai/combiner.js";
import { runQualityGate } from "../ai/quality-gate.js";
import { analyzeCoaching } from "../ai/coaching-analyzer.js";
import {
  seedDefaultRules,
  getRules,
  getActiveCoachingInsights,
  insertCoachingInsight,
  type Story,
  type Draft,
} from "../db/generate-queries.js";
import { createRun } from "../db/ai-queries.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-ai-modules.db");

let db: ReturnType<typeof initDatabase>;
let logger: AiLogger;

function makeMockClient(responseText: string): any {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    },
  };
}

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
  seedDefaultRules(db);
  const runId = createRun(db, "test", 0);
  logger = new AiLogger(db, runId);
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("researcher", () => {
  it("returns 3 stories from LLM response", async () => {
    const mockResponse = JSON.stringify({
      stories: [
        { headline: "AI Costs Plummet", summary: "Cloud AI pricing dropped 90%", source: "Industry", age: "This week", tag: "AI", angles: ["Cost angle"], is_stretch: false },
        { headline: "Remote Work Shift", summary: "Companies reversing RTO", source: "News", age: "Today", tag: "Work", angles: ["Culture angle"], is_stretch: false },
        { headline: "Biotech Breakthrough", summary: "New CRISPR technique", source: "Science", age: "This month", tag: "Biotech", angles: ["Future angle"], is_stretch: true },
      ],
    });
    const client = makeMockClient(mockResponse);
    const result = await researchStories(client, db, logger, "news");
    expect(result.stories).toHaveLength(3);
    expect(result.stories[2].is_stretch).toBe(true);
    expect(client.messages.create).toHaveBeenCalledOnce();
  });
});

describe("drafter", () => {
  it("generates 3 draft variations", async () => {
    const mockDraft = JSON.stringify({
      hook: "Everyone thinks AI is expensive. They're wrong.",
      body: "Here's what actually happened...",
      closing: "What's the most surprising cost reduction you've seen?",
      word_count: 280,
      structure_label: "Contrarian take with evidence",
    });
    const client = makeMockClient(mockDraft);
    const story: Story = {
      headline: "AI Costs Plummet",
      summary: "Cloud pricing dropped 90%",
      source: "Industry",
      age: "This week",
      tag: "AI",
      angles: ["Cost reduction angle"],
      is_stretch: false,
    };
    const result = await generateDrafts(client, db, logger, "news", story);
    expect(result.drafts).toHaveLength(3);
    expect(result.drafts[0].type).toBe("contrarian");
    expect(result.drafts[1].type).toBe("operator");
    expect(result.drafts[2].type).toBe("future");
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });
});

describe("combiner", () => {
  const drafts: Draft[] = [
    { type: "contrarian", hook: "Hook A", body: "Body A", closing: "Close A", word_count: 200, structure_label: "Contrarian" },
    { type: "operator", hook: "Hook B", body: "Body B", closing: "Close B", word_count: 250, structure_label: "Operator" },
    { type: "future", hook: "Hook C", body: "Body C", closing: "Close C", word_count: 220, structure_label: "Future" },
  ];

  it("returns single draft as-is without LLM call", async () => {
    const client = makeMockClient("");
    const result = await combineDrafts(client, logger, drafts, [0]);
    expect(result.final_draft).toContain("Hook A");
    expect(result.final_draft).toContain("Body A");
    expect(result.input_tokens).toBe(0);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("combines multiple drafts via LLM", async () => {
    const client = makeMockClient("Combined post text here with best elements from both drafts.");
    const result = await combineDrafts(client, logger, drafts, [0, 2], "Focus on the contrarian hook");
    expect(result.final_draft).toContain("Combined post");
    expect(result.input_tokens).toBe(100);
    expect(client.messages.create).toHaveBeenCalledOnce();
  });
});

describe("quality-gate", () => {
  it("returns quality gate checks", async () => {
    const mockResponse = JSON.stringify({
      passed: true,
      checks: [
        { name: "voice_match", status: "pass", detail: "Sounds authentic" },
        { name: "ai_tropes", status: "pass", detail: "No AI-isms detected" },
        { name: "hook_strength", status: "pass", detail: "Strong contrarian open" },
        { name: "engagement_close", status: "warn", detail: "Closing question is too broad" },
        { name: "concrete_specifics", status: "pass", detail: "Good use of numbers" },
        { name: "ending_quality", status: "pass", detail: "Extends the idea well" },
      ],
    });
    const client = makeMockClient(mockResponse);
    const rules = getRules(db);
    const insights = getActiveCoachingInsights(db);
    const result = await runQualityGate(client, logger, "Test draft text", rules, insights);
    expect(result.checks).toHaveLength(6);
    // Recalculated: one warn means passed = false
    expect(result.passed).toBe(false);
  });
});

describe("coaching-analyzer", () => {
  it("returns coaching change proposals", async () => {
    const mockResponse = JSON.stringify({
      changes: [
        {
          type: "new",
          title: "Use numbers early",
          evidence: "Top posts all include a number in the first sentence",
          new_text: "Include a specific number or metric in the opening hook",
        },
      ],
    });
    const client = makeMockClient(mockResponse);
    const result = await analyzeCoaching(client, db, logger);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].type).toBe("new");
    expect(result.changes[0].title).toBe("Use numbers early");
  });

  it("returns empty changes when nothing to improve", async () => {
    const client = makeMockClient(JSON.stringify({ changes: [] }));
    const result = await analyzeCoaching(client, db, logger);
    expect(result.changes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the AI module tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/ai-pipeline-modules.test.ts 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/ai-pipeline-modules.test.ts
git commit -m "test: add AI pipeline module tests with mocked Anthropic client"
```

---

## Chunk 3: Server Routes

### Task 11: Create generate.ts routes

**Files:**
- Create: `server/src/routes/generate.ts`

- [ ] **Step 1: Write the route file with research, drafts, and combine endpoints**

Create `server/src/routes/generate.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import {
  insertResearch,
  getResearch,
  insertGeneration,
  getGeneration,
  updateGeneration,
  listGenerations,
  insertRevision,
  getRules,
  replaceAllRules,
  seedDefaultRules,
  getActiveCoachingInsights,
  insertCoachingSync,
  getCoachingSync,
  completeCoachingSync,
  insertCoachingChangeLog,
  updateCoachingChangeDecision,
  getCoachingChangeLog,
  getCoachingSyncHistory,
  insertCoachingInsight,
  updateCoachingInsight,
  insertTopicLog,
  getAntiAiTropesEnabled,
  type Story,
  type Draft,
} from "../db/generate-queries.js";
import { createRun, completeRun, failRun } from "../db/ai-queries.js";
import { createClient, MODELS, calculateCostCents } from "../ai/client.js";
import { AiLogger } from "../ai/logger.js";
import { researchStories } from "../ai/researcher.js";
import { generateDrafts } from "../ai/drafter.js";
import { combineDrafts } from "../ai/combiner.js";
import { runQualityGate } from "../ai/quality-gate.js";
import { analyzeCoaching } from "../ai/coaching-analyzer.js";

function getClient(): Anthropic {
  const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
  if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required");
  return createClient(apiKey);
}

export function registerGenerateRoutes(app: FastifyInstance, db: Database.Database): void {
  // ── Research ─────────────────────────────────────────────

  app.post("/api/generate/research", async (request, reply) => {
    const { post_type } = request.body as { post_type: string };
    if (!["news", "topic", "insight"].includes(post_type)) {
      return reply.status(400).send({ error: "post_type must be news, topic, or insight" });
    }

    const client = getClient();
    const runId = createRun(db, "generate_research", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await researchStories(client, db, logger, post_type);

      const researchId = insertResearch(db, {
        post_type,
        stories_json: JSON.stringify(result.stories),
        sources_json: JSON.stringify(result.sources_metadata),
        article_count: result.article_count,
        source_count: result.source_count,
      });

      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      completeRun(db, runId, {
        input_tokens: logs.reduce((s, l) => s + l.input_tokens, 0),
        output_tokens: logs.reduce((s, l) => s + l.output_tokens, 0),
        cost_cents: calculateCostCents(logs),
      });

      return {
        research_id: researchId,
        stories: result.stories,
        article_count: result.article_count,
        source_count: result.source_count,
      };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Drafts ───────────────────────────────────────────────

  app.post("/api/generate/drafts", async (request, reply) => {
    const { research_id, story_index, post_type } = request.body as {
      research_id: number;
      story_index: number;
      post_type: string;
    };

    if (!["news", "topic", "insight"].includes(post_type)) {
      return reply.status(400).send({ error: "post_type must be news, topic, or insight" });
    }

    const research = getResearch(db, research_id);
    if (!research) {
      return reply.status(404).send({ error: "Research not found" });
    }

    const stories: Story[] = JSON.parse(research.stories_json);
    if (story_index < 0 || story_index >= stories.length) {
      return reply.status(400).send({ error: "Invalid story_index" });
    }

    const client = getClient();
    const runId = createRun(db, "generate_drafts", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await generateDrafts(
        client,
        db,
        logger,
        post_type as "news" | "topic" | "insight",
        stories[story_index]
      );

      const generationId = insertGeneration(db, {
        research_id,
        post_type,
        selected_story_index: story_index,
        drafts_json: JSON.stringify(result.drafts),
        prompt_snapshot: result.prompt_snapshot,
      });

      // Log topic for anti-narrowing
      insertTopicLog(db, {
        generation_id: generationId,
        topic_category: stories[story_index].tag,
        was_stretch: stories[story_index].is_stretch,
      });

      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      completeRun(db, runId, {
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        cost_cents: calculateCostCents(logs),
      });

      return { generation_id: generationId, drafts: result.drafts };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Combine ──────────────────────────────────────────────

  app.post("/api/generate/combine", async (request, reply) => {
    const { generation_id, selected_drafts, combining_guidance } = request.body as {
      generation_id: number;
      selected_drafts: number[];
      combining_guidance?: string;
    };

    const gen = getGeneration(db, generation_id);
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }

    const drafts: Draft[] = gen.drafts_json ? JSON.parse(gen.drafts_json) : [];
    if (drafts.length === 0) {
      return reply.status(400).send({ error: "No drafts available" });
    }

    const client = getClient();
    const runId = createRun(db, "generate_combine", 0);
    const logger = new AiLogger(db, runId);

    try {
      const combineResult = await combineDrafts(client, logger, drafts, selected_drafts, combining_guidance);

      // Run quality gate
      const rules = getRules(db);
      const insights = getActiveCoachingInsights(db);
      const qualityGate = await runQualityGate(client, logger, combineResult.final_draft, rules, insights);

      // Save revision if combining happened
      if (selected_drafts.length > 1) {
        insertRevision(db, {
          generation_id,
          action: "combine",
          input_draft: selected_drafts.map((i) => `Draft ${i + 1}`).join(" + "),
          output_draft: combineResult.final_draft,
          quality_gate_json: JSON.stringify(qualityGate),
          input_tokens: combineResult.input_tokens,
          output_tokens: combineResult.output_tokens,
          cost_cents: calculateCostCents([{ model: MODELS.SONNET, input_tokens: combineResult.input_tokens, output_tokens: combineResult.output_tokens }]),
        });
      }

      const genUpdate: Parameters<typeof updateGeneration>[2] = {
        selected_draft_indices: JSON.stringify(selected_drafts),
        final_draft: combineResult.final_draft,
        quality_gate_json: JSON.stringify(qualityGate),
      };
      if (combining_guidance !== undefined) {
        genUpdate.combining_guidance = combining_guidance;
      }
      updateGeneration(db, generation_id, genUpdate);

      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      completeRun(db, runId, {
        input_tokens: logs.reduce((s, l) => s + l.input_tokens, 0),
        output_tokens: logs.reduce((s, l) => s + l.output_tokens, 0),
        cost_cents: calculateCostCents(logs),
      });

      return { final_draft: combineResult.final_draft, quality_gate: qualityGate };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Revise ───────────────────────────────────────────────

  app.post("/api/generate/revise", async (request, reply) => {
    const { generation_id, action, instruction } = request.body as {
      generation_id: number;
      action: "regenerate" | "shorten" | "strengthen_close" | "custom";
      instruction?: string;
    };

    const gen = getGeneration(db, generation_id);
    if (!gen?.final_draft) {
      return reply.status(404).send({ error: "Generation not found or no final draft" });
    }

    const actionPrompts: Record<string, string> = {
      regenerate: "Rewrite this LinkedIn post from scratch, keeping the same core idea but finding a fresher angle and stronger hook.",
      shorten: "Make this LinkedIn post shorter and punchier. Cut anything that doesn't earn its place. Target 20-30% shorter.",
      strengthen_close: "Rewrite just the closing of this LinkedIn post. Make it a sharper question that invites informed disagreement or practitioner reflection.",
      custom: instruction ?? "Improve this post.",
    };

    const client = getClient();
    const runId = createRun(db, "generate_revise", 0);
    const logger = new AiLogger(db, runId);

    try {
      // Use the stored prompt snapshot as system context so revisions respect writing rules
      const systemPrompt = gen.prompt_snapshot ?? "You are a LinkedIn post ghostwriter.";

      const start = Date.now();
      const response = await client.messages.create({
        model: MODELS.SONNET,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `${actionPrompts[action]}\n\n## Current Draft\n${gen.final_draft}\n\nReturn the revised post as plain text only.`,
          },
        ],
      });

      const duration = Date.now() - start;
      const revisedDraft =
        response.content[0].type === "text" ? response.content[0].text.trim() : "";

      logger.log({
        step: `revise_${action}`,
        model: MODELS.SONNET,
        input_messages: JSON.stringify([{ role: "user", content: actionPrompts[action] }]),
        output_text: revisedDraft,
        tool_calls: null,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        thinking_tokens: 0,
        duration_ms: duration,
      });

      // Re-run quality gate
      const rules = getRules(db);
      const insights = getActiveCoachingInsights(db);
      const qualityGate = await runQualityGate(client, logger, revisedDraft, rules, insights);

      insertRevision(db, {
        generation_id,
        action,
        instruction: action === "custom" ? instruction : undefined,
        input_draft: gen.final_draft,
        output_draft: revisedDraft,
        quality_gate_json: JSON.stringify(qualityGate),
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cost_cents: calculateCostCents([{ model: MODELS.SONNET, input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }]),
      });

      updateGeneration(db, generation_id, {
        final_draft: revisedDraft,
        quality_gate_json: JSON.stringify(qualityGate),
      });

      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      completeRun(db, runId, {
        input_tokens: logs.reduce((s, l) => s + l.input_tokens, 0),
        output_tokens: logs.reduce((s, l) => s + l.output_tokens, 0),
        cost_cents: calculateCostCents(logs),
      });

      return { final_draft: revisedDraft, quality_gate: qualityGate };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Rules CRUD ───────────────────────────────────────────

  app.get("/api/generate/rules", async () => {
    const rules = getRules(db);
    const antiAiEnabled = getAntiAiTropesEnabled(db);

    const categories: Record<string, any> = {
      voice_tone: [] as any[],
      structure_formatting: [] as any[],
      anti_ai_tropes: { enabled: antiAiEnabled, rules: [] as any[] },
    };

    for (const rule of rules) {
      const item = { id: rule.id, rule_text: rule.rule_text, example_text: rule.example_text, sort_order: rule.sort_order };
      if (rule.category === "anti_ai_tropes") {
        categories.anti_ai_tropes.rules.push(item);
      } else if (categories[rule.category]) {
        (categories[rule.category] as any[]).push(item);
      }
    }

    return { categories };
  });

  app.put("/api/generate/rules", async (request) => {
    const { categories } = request.body as {
      categories: {
        voice_tone: Array<{ rule_text: string; example_text?: string; sort_order: number }>;
        structure_formatting: Array<{ rule_text: string; example_text?: string; sort_order: number }>;
        anti_ai_tropes: { enabled: boolean; rules: Array<{ rule_text: string; example_text?: string; sort_order: number }> };
      };
    };

    const allRules: Array<{ category: string; rule_text: string; example_text?: string; sort_order: number; enabled?: number }> = [];

    for (const rule of categories.voice_tone) {
      allRules.push({ category: "voice_tone", ...rule });
    }
    for (const rule of categories.structure_formatting) {
      allRules.push({ category: "structure_formatting", ...rule });
    }
    for (const rule of categories.anti_ai_tropes.rules) {
      allRules.push({ category: "anti_ai_tropes", ...rule, enabled: categories.anti_ai_tropes.enabled ? 1 : 0 });
    }

    replaceAllRules(db, allRules);
    return { ok: true };
  });

  app.post("/api/generate/rules/reset", async () => {
    seedDefaultRules(db);
    // Return the freshly-seeded rules in the same shape as GET
    const rules = getRules(db);
    const antiAiEnabled = getAntiAiTropesEnabled(db);
    const categories: Record<string, any> = {
      voice_tone: [] as any[],
      structure_formatting: [] as any[],
      anti_ai_tropes: { enabled: antiAiEnabled, rules: [] as any[] },
    };
    for (const rule of rules) {
      const item = { id: rule.id, rule_text: rule.rule_text, example_text: rule.example_text, sort_order: rule.sort_order };
      if (rule.category === "anti_ai_tropes") {
        categories.anti_ai_tropes.rules.push(item);
      } else if (categories[rule.category]) {
        (categories[rule.category] as any[]).push(item);
      }
    }
    return { categories };
  });

  // ── History ──────────────────────────────────────────────

  app.get("/api/generate/history", async (request) => {
    const q = request.query as { status?: string; offset?: string; limit?: string };
    const result = listGenerations(db, {
      status: q.status,
      offset: q.offset ? Number(q.offset) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });

    const summaries = result.generations.map((g) => {
      const drafts: Draft[] = g.drafts_json ? JSON.parse(g.drafts_json) : [];
      const hookExcerpt = g.final_draft
        ? g.final_draft.substring(0, 80) + (g.final_draft.length > 80 ? "..." : "")
        : drafts[0]?.hook?.substring(0, 80) ?? "";

      // Get story headline from research record
      let storyHeadline = "";
      if (g.research_id && g.selected_story_index !== null) {
        const research = getResearch(db, g.research_id);
        if (research) {
          const stories: Story[] = JSON.parse(research.stories_json);
          storyHeadline = stories[g.selected_story_index]?.headline ?? "";
        }
      }

      return {
        id: g.id,
        hook_excerpt: hookExcerpt,
        story_headline: storyHeadline,
        post_type: g.post_type,
        status: g.status,
        drafts_used: g.selected_draft_indices ? JSON.parse(g.selected_draft_indices).length : 0,
        created_at: g.created_at,
      };
    });

    return { generations: summaries, total: result.total };
  });

  app.get("/api/generate/history/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const gen = getGeneration(db, Number(id));
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }
    return gen;
  });

  app.post("/api/generate/history/:id/discard", async (request, reply) => {
    const { id } = request.params as { id: string };
    const gen = getGeneration(db, Number(id));
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }
    updateGeneration(db, Number(id), { status: "discarded" });
    return { ok: true };
  });

  // ── Coaching Sync ────────────────────────────────────────

  app.post("/api/generate/coaching/analyze", async (request, reply) => {
    const client = getClient();
    const runId = createRun(db, "coaching_analyze", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await analyzeCoaching(client, db, logger);

      const syncId = insertCoachingSync(db, JSON.stringify(result.changes));

      // Create change log entries
      const changes = result.changes.map((change) => {
        const changeId = insertCoachingChangeLog(db, {
          sync_id: syncId,
          insight_id: change.insight_id,
          change_type: change.type,
          old_text: change.old_text,
          new_text: change.new_text,
          evidence: change.evidence,
        });
        return { id: changeId, ...change };
      });

      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      completeRun(db, runId, {
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        cost_cents: calculateCostCents(logs),
      });

      return { sync_id: syncId, changes };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  app.patch("/api/generate/coaching/changes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { action, edited_text } = request.body as {
      action: "accept" | "skip" | "retire" | "keep";
      edited_text?: string;
    };

    const changeId = Number(id);

    // Get the change record
    const change = db
      .prepare("SELECT * FROM coaching_change_log WHERE id = ?")
      .get(changeId) as any;
    if (!change) {
      return reply.status(404).send({ error: "Change not found" });
    }

    // Apply the decision
    if (action === "accept") {
      if (change.change_type === "new") {
        insertCoachingInsight(db, {
          title: change.new_text?.substring(0, 50) ?? "New insight",
          prompt_text: edited_text ?? change.new_text ?? "",
          evidence: change.evidence,
          source_sync_id: change.sync_id,
        });
      } else if (change.change_type === "updated" && change.insight_id) {
        updateCoachingInsight(db, change.insight_id, {
          prompt_text: edited_text ?? change.new_text ?? "",
        });
      }
    } else if (action === "retire" && change.insight_id) {
      updateCoachingInsight(db, change.insight_id, {
        status: "retired",
        retired_at: new Date().toISOString(),
      });
    }

    updateCoachingChangeDecision(db, changeId, action);

    // Check if all changes in this sync have been decided — if so, complete the sync
    const allChanges = getCoachingChangeLog(db, change.sync_id);
    const allDecided = allChanges.every((c) => c.decision !== null);
    if (allDecided) {
      const accepted = allChanges.filter((c) => c.decision === "accept" || c.decision === "retire").length;
      const skipped = allChanges.filter((c) => c.decision === "skip" || c.decision === "keep").length;
      completeCoachingSync(db, change.sync_id, JSON.stringify(allChanges.map((c) => ({ id: c.id, decision: c.decision }))), accepted, skipped);
    }

    return { ok: true };
  });

  app.get("/api/generate/coaching/history", async () => {
    const syncs = getCoachingSyncHistory(db);
    return { syncs };
  });

  app.get("/api/generate/coaching/insights", async () => {
    const insights = getActiveCoachingInsights(db);
    return { insights };
  });
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/generate.ts
git commit -m "feat: add generate.ts with all /api/generate/* route handlers"
```

### Task 12: Register routes in app.ts

**Files:**
- Modify: `server/src/app.ts`

- [ ] **Step 1: Add the import**

Add after the existing route imports (around line 26):

```typescript
import { registerGenerateRoutes } from "./routes/generate.js";
```

- [ ] **Step 2: Register the routes**

Add after the `registerSettingsRoutes(app, dataDir, db);` line (around line 535):

```typescript
  // Generation routes (post generation pipeline)
  registerGenerateRoutes(app, db);
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add server/src/app.ts
git commit -m "feat: register generate routes in app.ts"
```

### Task 13: Write route integration tests

**Files:**
- Create: `server/src/__tests__/generate-routes.test.ts`

- [ ] **Step 1: Write integration tests for rules CRUD and history**

Create `server/src/__tests__/generate-routes.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-generate-routes.db");

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(TEST_DB_PATH);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("GET /api/generate/rules", () => {
  it("returns empty categories when no rules exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/rules" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories).toBeDefined();
    expect(body.categories.voice_tone).toBeDefined();
    expect(body.categories.structure_formatting).toBeDefined();
    expect(body.categories.anti_ai_tropes).toBeDefined();
  });
});

describe("POST /api/generate/rules/reset", () => {
  it("seeds default rules and returns them", async () => {
    const res = await app.inject({ method: "POST", url: "/api/generate/rules/reset" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories.voice_tone.length).toBeGreaterThan(0);
    expect(body.categories.structure_formatting.length).toBeGreaterThan(0);
    expect(body.categories.anti_ai_tropes.rules.length).toBeGreaterThan(0);
  });
});

describe("PUT /api/generate/rules", () => {
  it("replaces all rules", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/generate/rules",
      payload: {
        categories: {
          voice_tone: [{ rule_text: "Be direct", sort_order: 0 }],
          structure_formatting: [{ rule_text: "Short paragraphs", sort_order: 0 }],
          anti_ai_tropes: {
            enabled: true,
            rules: [{ rule_text: "No hedging", sort_order: 0 }],
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);

    // Verify
    const getRes = await app.inject({ method: "GET", url: "/api/generate/rules" });
    const body = getRes.json();
    expect(body.categories.voice_tone).toHaveLength(1);
    expect(body.categories.voice_tone[0].rule_text).toBe("Be direct");
  });
});

describe("GET /api/generate/history", () => {
  it("returns empty list initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/history" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generations).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe("GET /api/generate/history/:id", () => {
  it("returns 404 for non-existent generation", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/history/999" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/generate/history/:id/discard", () => {
  it("returns 404 for non-existent generation", async () => {
    const res = await app.inject({ method: "POST", url: "/api/generate/history/999/discard" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/generate/research", () => {
  it("rejects invalid post_type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/research",
      payload: { post_type: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  // Note: actual research requires TRUSTMIND_LLM_API_KEY, so we only test validation
});

describe("POST /api/generate/drafts", () => {
  it("returns 404 for non-existent research", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/drafts",
      payload: { research_id: 999, story_index: 0, post_type: "news" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/generate/combine", () => {
  it("returns 404 for non-existent generation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/combine",
      payload: { generation_id: 999, selected_drafts: [0] },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/generate/revise", () => {
  it("returns 404 for non-existent generation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/revise",
      payload: { generation_id: 999, action: "shorten" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/generate/coaching/insights", () => {
  it("returns empty insights initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/coaching/insights" });
    expect(res.statusCode).toBe(200);
    expect(res.json().insights).toEqual([]);
  });
});

describe("GET /api/generate/coaching/history", () => {
  it("returns empty history initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/coaching/history" });
    expect(res.statusCode).toBe(200);
    expect(res.json().syncs).toEqual([]);
  });
});

describe("PATCH /api/generate/coaching/changes/:id", () => {
  it("returns 404 for non-existent change", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/generate/coaching/changes/999",
      payload: { action: "skip" },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the route tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/generate-routes.test.ts 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/generate-routes.test.ts
git commit -m "test: add generate route integration tests"
```

### Task 14: Run full test suite

- [ ] **Step 1: Run all tests to ensure nothing is broken**

Run: `cd /Users/nate/code/linkedin && npx vitest run 2>&1 | tail -40`
Expected: All tests pass

- [ ] **Step 2: Verify full compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Migration 009 with 10 tables | `migrations/009-generation.sql` |
| 2 | DB query helpers | `db/generate-queries.ts` |
| 3 | 3-layer prompt assembler | `ai/prompt-assembler.ts` |
| 4 | Tests for DB + prompt assembler | `__tests__/generate-queries.test.ts`, `__tests__/prompt-assembler.test.ts` |
| 5 | Story researcher | `ai/researcher.ts` |
| 6 | 3-variation drafter | `ai/drafter.ts` |
| 7 | Draft combiner | `ai/combiner.ts` |
| 8 | Quality gate | `ai/quality-gate.ts` |
| 9 | Coaching analyzer | `ai/coaching-analyzer.ts` |
| 10 | AI module tests (mocked) | `__tests__/ai-pipeline-modules.test.ts` |
| 11 | All route handlers | `routes/generate.ts` |
| 12 | Register routes in app | `app.ts` |
| 13 | Route integration tests | `__tests__/generate-routes.test.ts` |
| 14 | Full test suite verification | — |
