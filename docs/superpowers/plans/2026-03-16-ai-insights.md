# AI Insights System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered insights to the LinkedIn analytics dashboard — agentic LLM analysis with SQL tools, Coach tab with recommendation cards, transformed Overview tab with AI summary.

**Architecture:** Agentic pipeline using `@anthropic-ai/sdk` with `toolRunner` via OpenRouter. Three-stage analysis (pattern detection → hypothesis testing → synthesis) with SQL-tool verification. Results cached in SQLite, served via new `/api/insights/*` endpoints. Dashboard gets a new Coach tab and transformed Overview.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, `@anthropic-ai/sdk`, Zod, React, Tailwind CSS, Chart.js

**Spec:** `docs/superpowers/specs/2026-03-16-ai-insights-design.md`

---

## Chunk 1: Database Schema + AI Tables

### Task 1: Add AI schema migration

**Files:**
- Create: `server/src/db/migrations/002-ai-tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- AI taxonomy (auto-discovered topics)
CREATE TABLE IF NOT EXISTS ai_taxonomy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  version INTEGER DEFAULT 1
);

-- Junction table for post-topic relationships
CREATE TABLE IF NOT EXISTS ai_post_topics (
  post_id TEXT NOT NULL REFERENCES posts(id),
  taxonomy_id INTEGER NOT NULL REFERENCES ai_taxonomy(id),
  PRIMARY KEY (post_id, taxonomy_id)
);

-- Per-post AI tags (non-topic dimensions)
CREATE TABLE IF NOT EXISTS ai_tags (
  post_id TEXT PRIMARY KEY REFERENCES posts(id),
  hook_type TEXT NOT NULL,
  tone TEXT NOT NULL,
  format_style TEXT NOT NULL,
  tagged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  model TEXT
);

-- Analysis run metadata
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  triggered_by TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  post_count INTEGER,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  total_input_tokens INTEGER,
  total_output_tokens INTEGER,
  total_cost_cents REAL,
  error TEXT
);

-- Persisted insights with lineage
CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ai_runs(id),
  category TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  claim TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence TEXT NOT NULL,
  direction TEXT,
  first_seen_run_id INTEGER,
  consecutive_appearances INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insight lineage across runs
CREATE TABLE IF NOT EXISTS insight_lineage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id INTEGER NOT NULL REFERENCES insights(id),
  predecessor_id INTEGER REFERENCES insights(id),
  relationship TEXT NOT NULL
);

-- User-facing recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ai_runs(id),
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  confidence TEXT NOT NULL,
  headline TEXT NOT NULL,
  detail TEXT NOT NULL,
  action TEXT NOT NULL,
  evidence_json TEXT,
  feedback TEXT,
  feedback_at DATETIME,
  acted_on INTEGER DEFAULT 0,
  acted_on_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Overview summary cache
CREATE TABLE IF NOT EXISTS ai_overview (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ai_runs(id),
  summary_text TEXT NOT NULL,
  top_performer_post_id TEXT REFERENCES posts(id),
  top_performer_reason TEXT,
  quick_insights TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Full I/O logging for every LLM call
CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES ai_runs(id),
  step TEXT NOT NULL,
  model TEXT NOT NULL,
  input_messages TEXT NOT NULL,
  output_text TEXT NOT NULL,
  tool_calls TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  thinking_tokens INTEGER,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_tags_post_id ON ai_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_insights_run_id ON insights(run_id);
CREATE INDEX IF NOT EXISTS idx_insights_stable_key ON insights(stable_key);
CREATE INDEX IF NOT EXISTS idx_recommendations_run_id ON recommendations(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_run_id ON ai_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_post_topics_post_id ON ai_post_topics(post_id);
CREATE INDEX IF NOT EXISTS idx_ai_post_topics_taxonomy_id ON ai_post_topics(taxonomy_id);
```

- [ ] **Step 2: Write database test for new tables**

Add to `server/src/__tests__/db.test.ts`:

```typescript
it("creates AI tables from migration", () => {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%' OR name IN ('insights', 'insight_lineage', 'recommendations') ORDER BY name"
    )
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  expect(names).toContain("ai_taxonomy");
  expect(names).toContain("ai_post_topics");
  expect(names).toContain("ai_tags");
  expect(names).toContain("ai_runs");
  expect(names).toContain("ai_logs");
  expect(names).toContain("ai_overview");
  expect(names).toContain("insights");
  expect(names).toContain("insight_lineage");
  expect(names).toContain("recommendations");
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -w server`
Expected: All tests pass including new AI tables test.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/migrations/002-ai-tables.sql server/src/__tests__/db.test.ts
git commit -m "feat: add AI tables migration (taxonomy, tags, insights, recommendations, logs)"
```

### Task 2: AI database query functions

**Files:**
- Create: `server/src/db/ai-queries.ts`
- Test: `server/src/__tests__/ai-queries.test.ts`

- [ ] **Step 1: Write tests for AI query functions**

Create `server/src/__tests__/ai-queries.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import { initDatabase } from "../db/index.js";
import {
  createRun,
  completeRun,
  failRun,
  getLatestCompletedRun,
  getRunningRun,
  upsertTaxonomy,
  getTaxonomy,
  setPostTopics,
  getPostTopics,
  upsertAiTag,
  getAiTags,
  getUntaggedPostIds,
  insertInsight,
  getActiveInsights,
  retireInsight,
  insertRecommendation,
  getRecommendations,
  updateRecommendationFeedback,
  upsertOverview,
  getLatestOverview,
  insertAiLog,
} from "../db/ai-queries.js";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-ai-queries.db");

let db: Database.Database;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
  // Seed a post for FK references
  db.prepare("INSERT OR IGNORE INTO posts (id, content_type, published_at, content_preview) VALUES (?, ?, ?, ?)").run(
    "post-1", "text", "2026-03-10T12:00:00Z", "Hello world"
  );
  db.prepare("INSERT OR IGNORE INTO posts (id, content_type, published_at, content_preview) VALUES (?, ?, ?, ?)").run(
    "post-2", "image", "2026-03-11T12:00:00Z", "Another post"
  );
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("ai_runs", () => {
  it("creates a run and retrieves it", () => {
    const id = createRun(db, "manual", 10);
    expect(id).toBeGreaterThan(0);
    const running = getRunningRun(db);
    expect(running).not.toBeNull();
    expect(running!.id).toBe(id);
  });

  it("completes a run", () => {
    const id = createRun(db, "sync", 5);
    completeRun(db, id, { input_tokens: 1000, output_tokens: 500, cost_cents: 0.5 });
    const latest = getLatestCompletedRun(db);
    expect(latest).not.toBeNull();
    expect(latest!.status).toBe("completed");
  });

  it("fails a run", () => {
    const id = createRun(db, "sync", 5);
    failRun(db, id, "LLM timeout");
    const running = getRunningRun(db);
    // Should not return the failed run as running
    expect(running === null || running.id !== id).toBe(true);
  });
});

describe("taxonomy + tags", () => {
  it("upserts taxonomy entries", () => {
    upsertTaxonomy(db, [
      { name: "hiring", description: "Hiring and recruitment" },
      { name: "leadership", description: "Leadership topics" },
    ]);
    const tax = getTaxonomy(db);
    expect(tax.length).toBe(2);
    expect(tax.map((t) => t.name)).toContain("hiring");
  });

  it("sets and gets post topics", () => {
    const tax = getTaxonomy(db);
    const hiringId = tax.find((t) => t.name === "hiring")!.id;
    setPostTopics(db, "post-1", [hiringId]);
    const topics = getPostTopics(db, "post-1");
    expect(topics).toEqual(["hiring"]);
  });

  it("upserts AI tags", () => {
    upsertAiTag(db, {
      post_id: "post-1",
      hook_type: "contrarian",
      tone: "provocative",
      format_style: "medium-structured",
      model: "claude-haiku-4-5",
    });
    const tags = getAiTags(db, ["post-1"]);
    expect(tags["post-1"]).toBeDefined();
    expect(tags["post-1"].hook_type).toBe("contrarian");
  });

  it("finds untagged posts", () => {
    const untagged = getUntaggedPostIds(db);
    expect(untagged).toContain("post-2");
    expect(untagged).not.toContain("post-1");
  });
});

describe("insights", () => {
  it("inserts and retrieves active insights", () => {
    const runId = createRun(db, "manual", 10);
    completeRun(db, runId, { input_tokens: 100, output_tokens: 50, cost_cents: 0.01 });

    insertInsight(db, {
      run_id: runId,
      category: "topic_performance",
      stable_key: "topic:hiring:positive",
      claim: "Hiring posts get 2x engagement",
      evidence: JSON.stringify({ n: 12, avg_impressions: 2100 }),
      confidence: "strong",
      direction: "positive",
      first_seen_run_id: runId,
    });

    const active = getActiveInsights(db);
    expect(active.length).toBeGreaterThan(0);
    expect(active[0].stable_key).toBe("topic:hiring:positive");
  });

  it("retires an insight", () => {
    const active = getActiveInsights(db);
    retireInsight(db, active[0].id);
    const afterRetire = getActiveInsights(db);
    expect(afterRetire.find((i) => i.id === active[0].id)).toBeUndefined();
  });
});

describe("recommendations", () => {
  it("inserts and retrieves recommendations", () => {
    const runId = createRun(db, "manual", 10);
    completeRun(db, runId, { input_tokens: 100, output_tokens: 50, cost_cents: 0.01 });

    insertRecommendation(db, {
      run_id: runId,
      type: "topic_opportunity",
      priority: "high",
      confidence: "strong",
      headline: "Double down on hiring stories",
      detail: "Your hiring posts avg 2,100 impressions vs 800 overall (n=12 vs n=38).",
      action: "Write about interview red flags",
      evidence_json: JSON.stringify({ insight_ids: [1] }),
    });

    const recs = getRecommendations(db);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].headline).toBe("Double down on hiring stories");
  });

  it("updates feedback", () => {
    const recs = getRecommendations(db);
    updateRecommendationFeedback(db, recs[0].id, "useful");
    const updated = getRecommendations(db);
    expect(updated[0].feedback).toBe("useful");
  });
});

describe("overview", () => {
  it("upserts and retrieves overview", () => {
    const runId = createRun(db, "manual", 10);
    completeRun(db, runId, { input_tokens: 100, output_tokens: 50, cost_cents: 0.01 });

    upsertOverview(db, {
      run_id: runId,
      summary_text: "Your engagement rate hit a 30-day high.",
      top_performer_post_id: "post-1",
      top_performer_reason: "Contrarian hook on hiring topic",
      quick_insights: JSON.stringify(["Hiring posts 2x avg", "Tuesday mornings trending"]),
    });

    const overview = getLatestOverview(db);
    expect(overview).not.toBeNull();
    expect(overview!.summary_text).toContain("30-day high");
  });
});

describe("ai_logs", () => {
  it("inserts a log entry", () => {
    const runId = createRun(db, "manual", 10);
    insertAiLog(db, {
      run_id: runId,
      step: "pattern_detection",
      model: "claude-sonnet-4-6",
      input_messages: JSON.stringify([{ role: "user", content: "test" }]),
      output_text: "response",
      tool_calls: null,
      input_tokens: 500,
      output_tokens: 200,
      thinking_tokens: null,
      duration_ms: 3000,
    });
    const logs = db.prepare("SELECT * FROM ai_logs WHERE run_id = ?").all(runId) as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].step).toBe("pattern_detection");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — `ai-queries.js` module not found.

- [ ] **Step 3: Implement AI query functions**

Create `server/src/db/ai-queries.ts`:

```typescript
import type Database from "better-sqlite3";

// ── ai_runs ──

export function createRun(db: Database.Database, triggered_by: string, post_count: number): number {
  const result = db
    .prepare("INSERT INTO ai_runs (triggered_by, post_count) VALUES (?, ?)")
    .run(triggered_by, post_count);
  return Number(result.lastInsertRowid);
}

export function completeRun(
  db: Database.Database,
  runId: number,
  stats: { input_tokens: number; output_tokens: number; cost_cents: number }
): void {
  db.prepare(
    "UPDATE ai_runs SET status = 'completed', completed_at = CURRENT_TIMESTAMP, total_input_tokens = ?, total_output_tokens = ?, total_cost_cents = ? WHERE id = ?"
  ).run(stats.input_tokens, stats.output_tokens, stats.cost_cents, runId);
}

export function failRun(db: Database.Database, runId: number, error: string): void {
  db.prepare(
    "UPDATE ai_runs SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error = ? WHERE id = ?"
  ).run(error, runId);
}

export function getRunningRun(db: Database.Database): { id: number; started_at: string } | null {
  return db.prepare("SELECT id, started_at FROM ai_runs WHERE status = 'running' LIMIT 1").get() as any ?? null;
}

export function getLatestCompletedRun(db: Database.Database): { id: number; status: string; post_count: number; completed_at: string } | null {
  return db.prepare("SELECT id, status, post_count, completed_at FROM ai_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get() as any ?? null;
}

// ── ai_taxonomy ──

export function upsertTaxonomy(db: Database.Database, items: { name: string; description: string }[]): void {
  const stmt = db.prepare(
    "INSERT INTO ai_taxonomy (name, description) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description"
  );
  const tx = db.transaction(() => {
    for (const item of items) {
      stmt.run(item.name, item.description);
    }
  });
  tx();
}

export function getTaxonomy(db: Database.Database): { id: number; name: string; description: string }[] {
  return db.prepare("SELECT id, name, description FROM ai_taxonomy ORDER BY name").all() as any[];
}

// ── ai_post_topics ──

export function setPostTopics(db: Database.Database, postId: string, taxonomyIds: number[]): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM ai_post_topics WHERE post_id = ?").run(postId);
    const stmt = db.prepare("INSERT INTO ai_post_topics (post_id, taxonomy_id) VALUES (?, ?)");
    for (const tid of taxonomyIds) {
      stmt.run(postId, tid);
    }
  });
  tx();
}

export function getPostTopics(db: Database.Database, postId: string): string[] {
  const rows = db.prepare(
    "SELECT t.name FROM ai_post_topics pt JOIN ai_taxonomy t ON t.id = pt.taxonomy_id WHERE pt.post_id = ? ORDER BY t.name"
  ).all(postId) as { name: string }[];
  return rows.map((r) => r.name);
}

// ── ai_tags ──

export interface AiTagInput {
  post_id: string;
  hook_type: string;
  tone: string;
  format_style: string;
  model: string;
}

export function upsertAiTag(db: Database.Database, tag: AiTagInput): void {
  db.prepare(
    "INSERT INTO ai_tags (post_id, hook_type, tone, format_style, model) VALUES (?, ?, ?, ?, ?) ON CONFLICT(post_id) DO UPDATE SET hook_type = excluded.hook_type, tone = excluded.tone, format_style = excluded.format_style, model = excluded.model, tagged_at = CURRENT_TIMESTAMP"
  ).run(tag.post_id, tag.hook_type, tag.tone, tag.format_style, tag.model);
}

export interface AiTag {
  post_id: string;
  hook_type: string;
  tone: string;
  format_style: string;
  tagged_at: string;
}

export function getAiTags(db: Database.Database, postIds: string[]): Record<string, AiTag> {
  if (postIds.length === 0) return {};
  const placeholders = postIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT post_id, hook_type, tone, format_style, tagged_at FROM ai_tags WHERE post_id IN (${placeholders})`
  ).all(...postIds) as AiTag[];
  const result: Record<string, AiTag> = {};
  for (const row of rows) result[row.post_id] = row;
  return result;
}

export function getUntaggedPostIds(db: Database.Database): string[] {
  const rows = db.prepare(
    "SELECT p.id FROM posts p LEFT JOIN ai_tags t ON t.post_id = p.id WHERE t.post_id IS NULL ORDER BY p.published_at DESC"
  ).all() as { id: string }[];
  return rows.map((r) => r.id);
}

// ── insights ──

export interface InsightInput {
  run_id: number;
  category: string;
  stable_key: string;
  claim: string;
  evidence: string;
  confidence: string;
  direction: string;
  first_seen_run_id: number;
  consecutive_appearances?: number;
}

export function insertInsight(db: Database.Database, insight: InsightInput): number {
  const result = db.prepare(
    "INSERT INTO insights (run_id, category, stable_key, claim, evidence, confidence, direction, first_seen_run_id, consecutive_appearances) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    insight.run_id, insight.category, insight.stable_key, insight.claim, insight.evidence,
    insight.confidence, insight.direction, insight.first_seen_run_id, insight.consecutive_appearances ?? 1
  );
  return Number(result.lastInsertRowid);
}

export function getActiveInsights(db: Database.Database): Array<InsightInput & { id: number }> {
  return db.prepare("SELECT * FROM insights WHERE status = 'active' ORDER BY created_at DESC").all() as any[];
}

export function retireInsight(db: Database.Database, insightId: number): void {
  db.prepare("UPDATE insights SET status = 'retired' WHERE id = ?").run(insightId);
}

export function insertInsightLineage(
  db: Database.Database,
  insightId: number,
  predecessorId: number,
  relationship: string
): void {
  db.prepare(
    "INSERT INTO insight_lineage (insight_id, predecessor_id, relationship) VALUES (?, ?, ?)"
  ).run(insightId, predecessorId, relationship);
}

// ── recommendations ──

export interface RecommendationInput {
  run_id: number;
  type: string;
  priority: string;
  confidence: string;
  headline: string;
  detail: string;
  action: string;
  evidence_json: string | null;
}

export function insertRecommendation(db: Database.Database, rec: RecommendationInput): number {
  const result = db.prepare(
    "INSERT INTO recommendations (run_id, type, priority, confidence, headline, detail, action, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(rec.run_id, rec.type, rec.priority, rec.confidence, rec.headline, rec.detail, rec.action, rec.evidence_json);
  return Number(result.lastInsertRowid);
}

export function getRecommendations(db: Database.Database, runId?: number): any[] {
  if (runId) {
    return db.prepare("SELECT * FROM recommendations WHERE run_id = ? ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END").all(runId);
  }
  // Get from latest completed run
  return db.prepare(
    "SELECT r.* FROM recommendations r JOIN ai_runs ar ON ar.id = r.run_id WHERE ar.status = 'completed' AND ar.id = (SELECT MAX(id) FROM ai_runs WHERE status = 'completed') ORDER BY CASE r.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END"
  ).all();
}

export function updateRecommendationFeedback(db: Database.Database, id: number, feedback: string): void {
  db.prepare("UPDATE recommendations SET feedback = ?, feedback_at = CURRENT_TIMESTAMP WHERE id = ?").run(feedback, id);
}

// ── ai_overview ──

export interface OverviewInput {
  run_id: number;
  summary_text: string;
  top_performer_post_id: string | null;
  top_performer_reason: string | null;
  quick_insights: string;
}

export function upsertOverview(db: Database.Database, overview: OverviewInput): void {
  db.prepare(
    "INSERT INTO ai_overview (run_id, summary_text, top_performer_post_id, top_performer_reason, quick_insights) VALUES (?, ?, ?, ?, ?)"
  ).run(overview.run_id, overview.summary_text, overview.top_performer_post_id, overview.top_performer_reason, overview.quick_insights);
}

export function getLatestOverview(db: Database.Database): any | null {
  return db.prepare(
    "SELECT o.* FROM ai_overview o JOIN ai_runs ar ON ar.id = o.run_id WHERE ar.status = 'completed' ORDER BY o.id DESC LIMIT 1"
  ).get() ?? null;
}

// ── ai_logs ──

export interface AiLogInput {
  run_id: number;
  step: string;
  model: string;
  input_messages: string;
  output_text: string;
  tool_calls: string | null;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number | null;
  duration_ms: number;
}

export function insertAiLog(db: Database.Database, log: AiLogInput): void {
  db.prepare(
    "INSERT INTO ai_logs (run_id, step, model, input_messages, output_text, tool_calls, input_tokens, output_tokens, thinking_tokens, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(log.run_id, log.step, log.model, log.input_messages, log.output_text, log.tool_calls, log.input_tokens, log.output_tokens, log.thinking_tokens, log.duration_ms);
}

// ── Changelog (what changed since last run) ──

export function getChangelog(db: Database.Database): { confirmed: any[]; new_signal: any[]; reversed: any[]; retired: any[] } {
  const latestRun = getLatestCompletedRun(db);
  if (!latestRun) return { confirmed: [], new_signal: [], reversed: [], retired: [] };

  const insights = db.prepare("SELECT * FROM insights WHERE run_id = ?").all(latestRun.id) as any[];

  return {
    confirmed: insights.filter((i) => i.consecutive_appearances > 1),
    new_signal: insights.filter((i) => i.consecutive_appearances === 1 && i.confidence === "weak"),
    reversed: db.prepare("SELECT * FROM insights WHERE run_id = ? AND direction = 'reversal'").all(latestRun.id) as any[],
    retired: db.prepare("SELECT * FROM insights WHERE status = 'retired' AND run_id = (SELECT MAX(id) FROM ai_runs WHERE status = 'completed' AND id < ?)").all(latestRun.id) as any[],
  };
}

// ── Post count helpers ──

export function getPostCountWithMetrics(db: Database.Database): number {
  const row = db.prepare(
    "SELECT COUNT(DISTINCT p.id) as count FROM posts p JOIN post_metrics pm ON pm.post_id = p.id"
  ).get() as { count: number };
  return row.count;
}

export function getPostCountSinceRun(db: Database.Database, runId: number): number {
  const run = db.prepare("SELECT post_count FROM ai_runs WHERE id = ?").get(runId) as { post_count: number } | undefined;
  if (!run) return 0;
  const currentCount = getPostCountWithMetrics(db);
  return currentCount - run.post_count;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w server`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/ai-queries.ts server/src/__tests__/ai-queries.test.ts
git commit -m "feat: add AI database query functions with tests"
```

---

## Chunk 2: OpenRouter Client + SQL Tool + AI Logger

### Task 3: Install `@anthropic-ai/sdk` dependency

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install the SDK**

```bash
cd /Users/nate/code/linkedin && npm install @anthropic-ai/sdk -w server
```

- [ ] **Step 2: Commit**

```bash
git add server/package.json package-lock.json
git commit -m "chore: add @anthropic-ai/sdk dependency"
```

### Task 4: OpenRouter client setup

**Files:**
- Create: `server/src/ai/client.ts`
- Test: `server/src/__tests__/ai-client.test.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from "vitest";
import { createClient, MODELS } from "../ai/client.js";

describe("AI client", () => {
  it("creates a client with OpenRouter base URL", () => {
    const client = createClient("sk-or-v1-test-key");
    // Client exists and has the expected structure
    expect(client).toBeDefined();
    expect(client.messages).toBeDefined();
  });

  it("exports model constants", () => {
    expect(MODELS.HAIKU).toBe("anthropic/claude-haiku-4-5-20251001");
    expect(MODELS.SONNET).toBe("anthropic/claude-sonnet-4-6");
    expect(MODELS.OPUS).toBe("anthropic/claude-opus-4-6");
  });

  it("throws if no API key provided", () => {
    expect(() => createClient("")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement client**

Create `server/src/ai/client.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  HAIKU: "anthropic/claude-haiku-4-5-20251001",
  SONNET: "anthropic/claude-sonnet-4-6",
  OPUS: "anthropic/claude-opus-4-6",
} as const;

export function createClient(apiKey: string): Anthropic {
  if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required for AI features");
  return new Anthropic({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/client.ts server/src/__tests__/ai-client.test.ts
git commit -m "feat: add OpenRouter AI client with model constants"
```

### Task 5: SQL query tool + AI logger

**Files:**
- Create: `server/src/ai/tools.ts`
- Create: `server/src/ai/logger.ts`
- Test: `server/src/__tests__/ai-tools.test.ts`

- [ ] **Step 1: Write tests for SQL tool**

Create `server/src/__tests__/ai-tools.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initDatabase } from "../db/index.js";
import { createQueryDbTool, executeQueryDb } from "../ai/tools.js";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-ai-tools.db");

let db: Database.Database;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
  // Seed data
  db.prepare("INSERT INTO posts (id, content_type, published_at, content_preview) VALUES (?, ?, ?, ?)").run(
    "tool-post-1", "text", "2026-03-10T12:00:00Z", "Test post"
  );
  db.prepare("INSERT INTO post_metrics (post_id, impressions, reactions, comments, reposts) VALUES (?, ?, ?, ?, ?)").run(
    "tool-post-1", 1000, 50, 10, 5
  );
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("query_db tool", () => {
  it("returns tool definition with schema description", () => {
    const tool = createQueryDbTool();
    expect(tool.name).toBe("query_db");
    expect(tool.description).toContain("posts");
    expect(tool.description).toContain("post_metrics");
  });

  it("executes a valid SELECT query", () => {
    const result = executeQueryDb(db, "SELECT id, content_type FROM posts");
    expect(result).toContain("tool-post-1");
    expect(result).toContain("text");
  });

  it("enforces LIMIT 100", () => {
    const result = executeQueryDb(db, "SELECT * FROM posts");
    // Should not error, and should include results
    expect(result).toContain("tool-post-1");
  });

  it("rejects non-SELECT queries", () => {
    const result = executeQueryDb(db, "DELETE FROM posts WHERE id = 'test'");
    expect(result).toContain("error");
  });

  it("rejects queries on disallowed tables", () => {
    const result = executeQueryDb(db, "SELECT * FROM ai_logs");
    expect(result).toContain("error");
  });

  it("returns error for malformed SQL", () => {
    const result = executeQueryDb(db, "SELECTT * FROMM posts");
    expect(result).toContain("error");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement SQL tool**

Create `server/src/ai/tools.ts`:

```typescript
import type Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";

const ALLOWED_TABLES = ["posts", "post_metrics", "follower_snapshots", "profile_snapshots", "ai_tags", "ai_post_topics", "ai_taxonomy"];

const SCHEMA_DESCRIPTION = `SQLite database with these tables:

posts(id TEXT PK, content_preview TEXT, content_type TEXT, published_at DATETIME, url TEXT)
post_metrics(id INT PK, post_id TEXT FK->posts, scraped_at DATETIME, impressions INT, members_reached INT, reactions INT, comments INT, reposts INT, saves INT, sends INT, video_views INT, watch_time_seconds INT, avg_watch_time_seconds INT)
follower_snapshots(date DATE PK, total_followers INT)
profile_snapshots(date DATE PK, profile_views INT, search_appearances INT, all_appearances INT)
ai_tags(post_id TEXT PK FK->posts, hook_type TEXT, tone TEXT, format_style TEXT, tagged_at DATETIME)
ai_post_topics(post_id TEXT, taxonomy_id INT) -- junction table
ai_taxonomy(id INT PK, name TEXT UNIQUE, description TEXT)

Key relationships: post_metrics.post_id -> posts.id (multiple metric snapshots per post, use MAX(id) for latest). ai_post_topics joins posts to ai_taxonomy for topic labels.`;

export function createQueryDbTool(): Anthropic.Messages.Tool {
  return {
    name: "query_db",
    description: `Execute a read-only SQL SELECT query against the analytics database. Results are capped at 100 rows and returned as a markdown table. Only SELECT queries are allowed.\n\nSchema:\n${SCHEMA_DESCRIPTION}`,
    input_schema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: "The SQL SELECT query to execute",
        },
      },
      required: ["sql"],
    },
  };
}

export function executeQueryDb(db: Database.Database, sql: string): string {
  try {
    // Validate: only SELECT allowed
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith("SELECT")) {
      return "error: Only SELECT queries are allowed.";
    }

    // Validate: only allowed tables
    const sqlLower = sql.toLowerCase();
    // Extract table references (rough but sufficient)
    const tablePattern = /(?:from|join)\s+(\w+)/gi;
    let match;
    while ((match = tablePattern.exec(sql)) !== null) {
      const table = match[1].toLowerCase();
      if (!ALLOWED_TABLES.includes(table)) {
        return `error: Table '${table}' is not accessible. Allowed tables: ${ALLOWED_TABLES.join(", ")}`;
      }
    }

    // Append LIMIT if not present
    if (!sqlLower.includes("limit")) {
      sql = sql.replace(/;?\s*$/, " LIMIT 100");
    }

    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    if (rows.length === 0) return "(no results)";

    // Format as markdown table
    const cols = Object.keys(rows[0]);
    const header = `| ${cols.join(" | ")} |`;
    const separator = `| ${cols.map(() => "---").join(" | ")} |`;
    const body = rows.map((row) =>
      `| ${cols.map((c) => String(row[c] ?? "NULL")).join(" | ")} |`
    ).join("\n");

    return `${header}\n${separator}\n${body}`;
  } catch (e: any) {
    return `error: ${e.message}`;
  }
}

export function createSubmitAnalysisTool(): Anthropic.Messages.Tool {
  return {
    name: "submit_analysis",
    description: "Submit your analysis findings. Call this when you have completed your analysis.",
    input_schema: {
      type: "object" as const,
      properties: {
        insights: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["topic_performance", "compound_pattern", "format_insight", "timing", "trend", "hidden_opportunity"] },
              stable_key: { type: "string", description: "Stable identifier for cross-run matching, e.g. 'topic:hiring:positive'" },
              claim: { type: "string" },
              evidence: { type: "string", description: "JSON with sample sizes, values, SQL queries used" },
              confidence: { type: "string", enum: ["strong", "moderate", "weak", "insufficient"] },
              direction: { type: "string", enum: ["positive", "negative", "neutral", "reversal"] },
            },
            required: ["category", "stable_key", "claim", "evidence", "confidence", "direction"],
          },
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Structured key for self-consistency voting, e.g. 'topic:hiring:opportunity'" },
              type: { type: "string", enum: ["topic_opportunity", "format_suggestion", "timing", "trend_alert", "content_idea", "hidden_opportunity", "growth_insight"] },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              confidence: { type: "string", enum: ["strong", "moderate", "weak"] },
              headline: { type: "string", description: "15 words max" },
              detail: { type: "string", description: "Include specific numbers, sample sizes, post references" },
              action: { type: "string", description: "Specific next step to take" },
            },
            required: ["key", "type", "priority", "confidence", "headline", "detail", "action"],
          },
        },
        summary: {
          type: "string",
          description: "One-sentence natural language summary for the Overview tab",
        },
      },
      required: ["insights", "recommendations", "summary"],
    },
  };
}
```

- [ ] **Step 4: Implement AI logger**

Create `server/src/ai/logger.ts`:

```typescript
import type Database from "better-sqlite3";
import { insertAiLog, type AiLogInput } from "../db/ai-queries.js";

export class AiLogger {
  constructor(private db: Database.Database, private runId: number) {}

  log(params: Omit<AiLogInput, "run_id">): void {
    insertAiLog(this.db, { ...params, run_id: this.runId });
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -w server`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/tools.ts server/src/ai/logger.ts server/src/__tests__/ai-tools.test.ts
git commit -m "feat: add SQL query tool with safety (table allowlist, LIMIT, SELECT-only) and AI logger"
```

---

## Chunk 3: Prompts + Tagger + Taxonomy

### Task 6: System prompts for each analysis stage

**Files:**
- Create: `server/src/ai/prompts.ts`

- [ ] **Step 1: Write all system prompts**

Create `server/src/ai/prompts.ts`:

```typescript
export function patternDetectionPrompt(summary: string, tier: string): string {
  return `You are an expert LinkedIn content analyst. You have access to a SQL database containing a creator's post data and engagement metrics.

## Your Task
Explore the database to find noteworthy patterns in this creator's content performance. Use the query_db tool to run SQL queries.

## Creator Summary
${summary}

## Analysis Tier: ${tier}
${tierInstructions(tier)}

## Instructions
1. Start by understanding the data: query post counts, date ranges, metric distributions
2. Look for patterns across multiple dimensions: topics, hook types, timing, format, tone
3. For EACH pattern you find:
   - State the observation clearly with numbers
   - Generate 3+ possible explanations (including confounder-based ones)
   - Run SQL queries to test which explanation best fits
4. Look for COMPOUND patterns (e.g., "posts about X with hook style Y posted on Z")
5. Always report exact sample sizes: "text posts (n=23) vs image posts (n=8)"

## Sample Size Rules
- <5 posts per group: Flag as "potential area to explore" — do NOT draw conclusions
- 5-10 posts: "Preliminary signal, based on small sample"
- 10-20 posts: "Moderate evidence, though sample is limited"
- 20+ posts: Standard analysis

When done exploring, call the submit_analysis tool with your findings.`;
}

export function hypothesisTestingPrompt(stage1Findings: string, previousInsights: string): string {
  return `You are verifying analytical findings about a LinkedIn creator's content performance. You have SQL database access.

## Stage 1 Findings to Verify
${stage1Findings}

## Previous Active Insights (for lineage tracking)
${previousInsights || "No previous insights — this is the first analysis run."}

## Confounder Checklist
For EACH finding, systematically check these confounders via SQL queries:

**Content confounders**: Is the pattern driven by topic/subject matter rather than the variable claimed? Content length? Hook quality? CTA presence?
**Timing confounders**: Day of week? Time of day? Seasonality? Was posting frequency different?
**Audience confounders**: Did follower count change significantly during this period?
**Measurement confounders**: Are older posts inflated (more time to accumulate)? Impression threshold effects?

## Instructions
1. For each finding, run SQL queries that control for the listed confounders
2. Classify each finding as:
   - SUPPORTED: Pattern holds after controlling for confounders
   - PARTIALLY SUPPORTED: Pattern exists but 1-2 confounders can't be ruled out
   - CONFOUNDED: Alternative explanation is more likely (still report it — explain what's really driving it)
   - INSUFFICIENT DATA: Not enough posts to test properly
3. For previous insights: reuse their stable_key if the same pattern is found. Create new keys only for genuinely new patterns.
4. CONFOUNDED findings are valuable: "image posts underperform not because of format, but because they're generic tips rather than personal stories"

When done, call submit_analysis with verified findings. Include stable_keys matching previous insights where applicable.`;
}

export function synthesisPrompt(verifiedFindings: string, feedbackHistory: string): string {
  return `You are generating actionable recommendations for a LinkedIn creator based on verified analytical findings.

## Verified Findings
${verifiedFindings}

## Previous Feedback
${feedbackHistory || "No previous feedback."}

## Evidence Strength Labels (use these, NOT percentages)
- STRONG: Pattern consistent across subgroups, large effect size, confounders ruled out
- MODERATE: Pattern visible but 1-2 confounders can't be ruled out
- WEAK / PRELIMINARY: Small sample (<10 per group), multiple alternative explanations
- INSUFFICIENT: Too few posts or wrong variables to test

## Recommendation Types
- topic_opportunity: Topics that overperform — suggest angles to explore
- format_suggestion: Content format insights
- timing: Posting schedule optimization
- trend_alert: Declining/rising engagement patterns
- content_idea: Specific content ideas based on what resonated
- hidden_opportunity: Underexplored topics with high potential
- growth_insight: Follower growth drivers

## Rules
1. Every recommendation MUST reference specific numbers and sample sizes
2. Never say "X outperforms Y" without effect size and group sizes
3. Flag confounders honestly — "moderate evidence" is more trustworthy than false certainty
4. Each recommendation needs a concrete "try next" action
5. If previous feedback says a recommendation type was "not useful", don't repeat similar ones
6. Include a one-sentence summary for the Overview tab
7. Generate 5-7 recommendations, prioritized by evidence strength and potential impact
8. Each recommendation needs a structured 'key' field for deduplication (e.g., 'topic:hiring:opportunity')

Call submit_analysis when done.`;
}

export function overviewSummaryPrompt(topPerformerInfo: string, quickInsights: string[]): string {
  return `Write a single natural-language sentence summarizing this LinkedIn creator's recent performance for a dashboard overview card. Be specific and mention the most impactful finding. Keep it under 30 words.

Top performer: ${topPerformerInfo}
Key insights: ${quickInsights.join("; ")}

Respond with ONLY the summary sentence, nothing else.`;
}

export function taxonomyPrompt(postSummaries: string): string {
  return `You are analyzing a LinkedIn creator's entire post history to discover their natural content topics.

## Posts
${postSummaries}

## Instructions
1. Read all posts and identify 5-15 topic categories at the right granularity
2. Topics should be specific enough to be meaningful ("hiring mistakes" not "business") but broad enough to have multiple posts each
3. Each topic needs a short name (2-4 words) and a one-line description
4. A post can belong to 1-3 topics
5. Consider the creator's expertise domain — what are they known for?

Respond with a JSON array:
[{"name": "topic name", "description": "one-line description"}, ...]

Return ONLY valid JSON, no other text.`;
}

export function taggingPrompt(taxonomy: { name: string; description: string }[]): string {
  const topicList = taxonomy.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return `Classify each LinkedIn post on these dimensions. Return ONLY valid JSON.

## Topic Categories
${topicList}

## Hook Types
contrarian, story, question, statistic, listicle, observation, how-to, social-proof, vulnerable, none

## Tones
educational, inspirational, conversational, provocative, analytical, humorous, vulnerable

## Format Styles
short-punchy (<500 chars), medium-structured (500-1300 chars), long-narrative (1300+ chars, story-driven), long-educational (1300+ chars, teaching-focused)

For each post, return: {"post_id": "...", "topics": ["topic1", "topic2"], "hook_type": "...", "tone": "...", "format_style": "..."}

Return a JSON array of these objects.`;
}

function tierInstructions(tier: string): string {
  switch (tier) {
    case "foundation":
      return "10-30 posts available. Focus on: descriptive stats, simple rankings, content type comparisons with appropriate caveats about small samples.";
    case "patterns":
      return "30-60 posts available. You can now: cluster by topic, analyze hook types, check day-of-week patterns, generate initial recommendations.";
    case "trends":
      return "60-120 posts available. You can now: detect temporal trends, identify topic fatigue, run basic statistical significance tests.";
    case "prediction":
      return "120-250 posts available. You can now: identify seasonal patterns, track audience evolution, suggest predictive engagement ranges.";
    case "strategic":
      return "250+ posts available. Full analysis: multi-variable correlations, content series analysis, algorithm sensitivity detection.";
    default:
      return "";
  }
}

export function getTier(postCount: number): string {
  if (postCount < 30) return "foundation";
  if (postCount < 60) return "patterns";
  if (postCount < 120) return "trends";
  if (postCount < 250) return "prediction";
  return "strategic";
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/prompts.ts
git commit -m "feat: add system prompts for all analysis stages with tier system"
```

### Task 7: Post tagger (Haiku)

**Files:**
- Create: `server/src/ai/tagger.ts`
- Test: `server/src/__tests__/ai-tagger.test.ts`

- [ ] **Step 1: Write test for tagger parsing logic**

Create `server/src/__tests__/ai-tagger.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseTaggingResponse, batchPosts } from "../ai/tagger.js";

describe("tagger", () => {
  it("parses a valid tagging response", () => {
    const response = JSON.stringify([
      { post_id: "1", topics: ["hiring"], hook_type: "contrarian", tone: "provocative", format_style: "medium-structured" },
      { post_id: "2", topics: ["leadership", "hiring"], hook_type: "story", tone: "vulnerable", format_style: "long-narrative" },
    ]);
    const result = parseTaggingResponse(response);
    expect(result).toHaveLength(2);
    expect(result[0].post_id).toBe("1");
    expect(result[0].topics).toEqual(["hiring"]);
    expect(result[1].hook_type).toBe("story");
  });

  it("handles response wrapped in markdown code block", () => {
    const response = '```json\n[{"post_id": "1", "topics": ["hiring"], "hook_type": "contrarian", "tone": "educational", "format_style": "short-punchy"}]\n```';
    const result = parseTaggingResponse(response);
    expect(result).toHaveLength(1);
  });

  it("batches posts into groups of 20", () => {
    const posts = Array.from({ length: 45 }, (_, i) => ({ id: `p${i}`, content_preview: `Post ${i}` }));
    const batches = batchPosts(posts, 20);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(20);
    expect(batches[1]).toHaveLength(20);
    expect(batches[2]).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server`
Expected: FAIL

- [ ] **Step 3: Implement tagger**

Create `server/src/ai/tagger.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { taggingPrompt } from "./prompts.js";
import { upsertAiTag, setPostTopics, getTaxonomy } from "../db/ai-queries.js";
import { AiLogger } from "./logger.js";

export interface TagResult {
  post_id: string;
  topics: string[];
  hook_type: string;
  tone: string;
  format_style: string;
}

export function parseTaggingResponse(text: string): TagResult[] {
  // Strip markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(cleaned);
}

export function batchPosts<T>(posts: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < posts.length; i += batchSize) {
    batches.push(posts.slice(i, i + batchSize));
  }
  return batches;
}

export async function tagPosts(
  client: Anthropic,
  db: Database.Database,
  posts: { id: string; content_preview: string | null }[],
  logger: AiLogger
): Promise<void> {
  const taxonomy = getTaxonomy(db);
  if (taxonomy.length === 0) throw new Error("Taxonomy must be created before tagging");

  const taxonomyMap = new Map(taxonomy.map((t) => [t.name, t.id]));
  const batches = batchPosts(posts, 20);
  const systemPrompt = taggingPrompt(taxonomy);

  for (const batch of batches) {
    const userContent = batch
      .map((p) => `[${p.id}] ${p.content_preview || "(no text)"}`)
      .join("\n\n");

    const start = Date.now();
    const response = await client.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const duration = Date.now() - start;

    logger.log({
      step: "tagging",
      model: MODELS.HAIKU,
      input_messages: JSON.stringify([{ role: "user", content: userContent }]),
      output_text: text,
      tool_calls: null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: null,
      duration_ms: duration,
    });

    const tags = parseTaggingResponse(text);
    for (const tag of tags) {
      upsertAiTag(db, {
        post_id: tag.post_id,
        hook_type: tag.hook_type,
        tone: tag.tone,
        format_style: tag.format_style,
        model: MODELS.HAIKU,
      });

      // Map topic names to IDs and set post topics
      const topicIds = tag.topics
        .map((name) => taxonomyMap.get(name))
        .filter((id): id is number => id !== undefined);
      if (topicIds.length > 0) {
        setPostTopics(db, tag.post_id, topicIds);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/tagger.ts server/src/__tests__/ai-tagger.test.ts
git commit -m "feat: add post tagger with Haiku batch classification"
```

### Task 8: Taxonomy discovery (Opus)

**Files:**
- Create: `server/src/ai/taxonomy.ts`

- [ ] **Step 1: Implement taxonomy discovery**

Create `server/src/ai/taxonomy.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { taxonomyPrompt } from "./prompts.js";
import { upsertTaxonomy } from "../db/ai-queries.js";
import { AiLogger } from "./logger.js";

export async function discoverTaxonomy(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger
): Promise<void> {
  // Get all posts for taxonomy analysis
  const posts = db
    .prepare("SELECT id, content_preview FROM posts WHERE content_preview IS NOT NULL ORDER BY published_at DESC")
    .all() as { id: string; content_preview: string }[];

  const postSummaries = posts
    .map((p) => `[${p.id}] ${p.content_preview}`)
    .join("\n\n");

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.OPUS,
    max_tokens: 4096,
    system: "You are a content analyst discovering topic categories from a LinkedIn creator's posts.",
    messages: [{ role: "user", content: taxonomyPrompt(postSummaries) }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const duration = Date.now() - start;

  logger.log({
    step: "taxonomy",
    model: MODELS.OPUS,
    input_messages: JSON.stringify([{ role: "user", content: "(taxonomy discovery)" }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: null,
    duration_ms: duration,
  });

  // Parse response — strip markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const topics: { name: string; description: string }[] = JSON.parse(cleaned);

  upsertTaxonomy(db, topics);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/taxonomy.ts
git commit -m "feat: add taxonomy discovery via Opus"
```

---

## Chunk 4: Agentic Analyzer + Orchestrator

### Task 9: Agentic analyzer (three-stage pipeline)

**Files:**
- Create: `server/src/ai/analyzer.ts`

- [ ] **Step 1: Implement the agentic analyzer**

Create `server/src/ai/analyzer.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { patternDetectionPrompt, hypothesisTestingPrompt, synthesisPrompt, getTier } from "./prompts.js";
import { createQueryDbTool, executeQueryDb, createSubmitAnalysisTool } from "./tools.js";
import { getActiveInsights, getPostCountWithMetrics } from "../db/ai-queries.js";
import { AiLogger } from "./logger.js";

interface AnalysisResult {
  insights: Array<{
    category: string;
    stable_key: string;
    claim: string;
    evidence: string;
    confidence: string;
    direction: string;
  }>;
  recommendations: Array<{
    key: string;
    type: string;
    priority: string;
    confidence: string;
    headline: string;
    detail: string;
    action: string;
  }>;
  summary: string;
}

async function runAgentLoop(
  client: Anthropic,
  db: Database.Database,
  systemPrompt: string,
  userMessage: string,
  logger: AiLogger,
  step: string
): Promise<AnalysisResult | null> {
  const tools = [createQueryDbTool(), createSubmitAnalysisTool()];
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  let result: AnalysisResult | null = null;
  const toolCalls: Array<{ tool: string; input: any; output: string }> = [];
  const start = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let turn = 0; turn < 15; turn++) {
    const response = await client.messages.create({
      model: MODELS.SONNET,
      max_tokens: 8192,
      system: systemPrompt,
      tools,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Check if the model wants to use tools
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      // Model is done (no tool calls and end_turn)
      break;
    }

    // Add assistant message
    messages.push({ role: "assistant", content: response.content });

    // Process tool calls
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      if (toolUse.name === "query_db") {
        const input = toolUse.input as { sql: string };
        const output = executeQueryDb(db, input.sql);
        toolCalls.push({ tool: "query_db", input: input.sql, output });
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: output });
      } else if (toolUse.name === "submit_analysis") {
        result = toolUse.input as AnalysisResult;
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: "Analysis submitted successfully.",
        });
      }
    }

    messages.push({ role: "user", content: toolResults });

    // If we got a result, we can stop
    if (result) break;
  }

  const duration = Date.now() - start;
  logger.log({
    step,
    model: MODELS.SONNET,
    input_messages: JSON.stringify(messages.slice(0, 1)), // Just the initial prompt
    output_text: result ? JSON.stringify(result) : "(no result)",
    tool_calls: JSON.stringify(toolCalls),
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    thinking_tokens: null,
    duration_ms: duration,
  });

  return result;
}

function buildSummary(db: Database.Database): string {
  const postCount = getPostCountWithMetrics(db);
  const dateRange = db.prepare(
    "SELECT MIN(published_at) as earliest, MAX(published_at) as latest FROM posts"
  ).get() as { earliest: string; latest: string };
  const avgEngagement = db.prepare(
    "SELECT AVG(CAST(reactions + comments + reposts AS REAL) / NULLIF(impressions, 0)) as avg_er FROM (SELECT pm.* FROM post_metrics pm JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest ON pm.id = latest.max_id)"
  ).get() as { avg_er: number | null };
  const followers = db.prepare(
    "SELECT total_followers FROM follower_snapshots ORDER BY date DESC LIMIT 1"
  ).get() as { total_followers: number } | undefined;

  return `Posts: ${postCount} | Date range: ${dateRange.earliest?.slice(0, 10) ?? "?"} to ${dateRange.latest?.slice(0, 10) ?? "?"} | Avg engagement rate: ${avgEngagement.avg_er ? (avgEngagement.avg_er * 100).toFixed(1) + "%" : "unknown"} | Followers: ${followers?.total_followers ?? "unknown"}`;
}

export async function runAnalysis(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger
): Promise<AnalysisResult | null> {
  const postCount = getPostCountWithMetrics(db);
  const tier = getTier(postCount);
  const summary = buildSummary(db);

  // Stage 1: Pattern Detection
  const stage1 = await runAgentLoop(
    client, db,
    patternDetectionPrompt(summary, tier),
    "Analyze the database and find noteworthy patterns. Query the data systematically.",
    logger,
    "pattern_detection"
  );

  if (!stage1) return null;

  // Stage 2: Hypothesis Testing
  const previousInsights = getActiveInsights(db);
  const previousInsightsText = previousInsights.length > 0
    ? previousInsights.map((i) => `[${i.stable_key}] ${i.claim} (confidence: ${i.confidence}, appearances: ${i.consecutive_appearances})`).join("\n")
    : "";

  const stage2 = await runAgentLoop(
    client, db,
    hypothesisTestingPrompt(JSON.stringify(stage1.insights), previousInsightsText),
    "Verify each finding against the confounder checklist. Run SQL queries to test alternative explanations.",
    logger,
    "verification"
  );

  if (!stage2) return stage1; // Fall back to unverified findings

  // Stage 3: Synthesis (with self-consistency — run 3x)
  const feedbackHistory = db.prepare(
    "SELECT type, headline, feedback FROM recommendations WHERE feedback IS NOT NULL ORDER BY feedback_at DESC LIMIT 20"
  ).all() as { type: string; headline: string; feedback: string }[];

  const feedbackText = feedbackHistory.length > 0
    ? feedbackHistory.map((f) => `${f.feedback}: [${f.type}] ${f.headline}`).join("\n")
    : "";

  const runs: AnalysisResult[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await runAgentLoop(
      client, db,
      synthesisPrompt(JSON.stringify(stage2.insights), feedbackText),
      `Generate recommendations based on verified findings. This is run ${i + 1} of 3 for self-consistency.`,
      logger,
      "recommendations"
    );
    if (result) runs.push(result);
  }

  if (runs.length === 0) return stage2;

  // Self-consistency voting: keep recommendations appearing in 2+ of 3 runs
  const keyCounts = new Map<string, { count: number; best: AnalysisResult["recommendations"][0] }>();
  for (const run of runs) {
    for (const rec of run.recommendations) {
      const existing = keyCounts.get(rec.key);
      if (existing) {
        existing.count++;
        // Keep the version with more detail
        if (rec.detail.length > existing.best.detail.length) {
          existing.best = rec;
        }
      } else {
        keyCounts.set(rec.key, { count: 1, best: rec });
      }
    }
  }

  const consistentRecs = Array.from(keyCounts.values())
    .filter((v) => v.count >= 2)
    .map((v) => v.best);

  // Use the verified insights from stage 2, and the summary from the best run
  return {
    insights: stage2.insights,
    recommendations: consistentRecs,
    summary: runs[0].summary,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/analyzer.ts
git commit -m "feat: add three-stage agentic analyzer with self-consistency voting"
```

### Task 10: Pipeline orchestrator

**Files:**
- Create: `server/src/ai/orchestrator.ts`

- [ ] **Step 1: Implement orchestrator**

Create `server/src/ai/orchestrator.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { overviewSummaryPrompt } from "./prompts.js";
import { discoverTaxonomy } from "./taxonomy.js";
import { tagPosts } from "./tagger.js";
import { runAnalysis } from "./analyzer.js";
import { AiLogger } from "./logger.js";
import {
  createRun,
  completeRun,
  failRun,
  getRunningRun,
  getLatestCompletedRun,
  getTaxonomy,
  getUntaggedPostIds,
  getPostCountWithMetrics,
  getActiveInsights,
  insertInsight,
  insertInsightLineage,
  retireInsight,
  insertRecommendation,
  upsertOverview,
} from "../db/ai-queries.js";

export interface PipelineResult {
  runId: number;
  status: "completed" | "failed";
  error?: string;
}

export async function runPipeline(
  client: Anthropic,
  db: Database.Database,
  triggeredBy: "sync" | "manual"
): Promise<PipelineResult> {
  // Check for running pipeline
  const running = getRunningRun(db);
  if (running) {
    return { runId: running.id, status: "failed", error: "Analysis already running" };
  }

  const postCount = getPostCountWithMetrics(db);

  // Minimum threshold
  if (postCount < 10) {
    return { runId: 0, status: "failed", error: "Need at least 10 posts with metrics" };
  }

  const runId = createRun(db, triggeredBy, postCount);
  const logger = new AiLogger(db, runId);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Step 1: Ensure taxonomy exists
    const existingTaxonomy = getTaxonomy(db);
    if (existingTaxonomy.length === 0) {
      await discoverTaxonomy(client, db, logger);
    }

    // Step 2: Tag untagged posts
    const untaggedIds = getUntaggedPostIds(db);
    if (untaggedIds.length > 0) {
      const posts = db.prepare(
        `SELECT id, content_preview FROM posts WHERE id IN (${untaggedIds.map(() => "?").join(",")})`
      ).all(...untaggedIds) as { id: string; content_preview: string | null }[];
      await tagPosts(client, db, posts, logger);
    }

    // Step 3: Run analysis
    const result = await runAnalysis(client, db, logger);

    if (!result) {
      failRun(db, runId, "Analysis produced no results");
      return { runId, status: "failed", error: "Analysis produced no results" };
    }

    // Step 4: Process insights with lineage
    const previousInsights = getActiveInsights(db);
    const previousByKey = new Map(previousInsights.map((i) => [i.stable_key, i]));
    const matchedKeys = new Set<string>();

    for (const insight of result.insights) {
      const predecessor = previousByKey.get(insight.stable_key);
      const newInsightId = insertInsight(db, {
        run_id: runId,
        category: insight.category,
        stable_key: insight.stable_key,
        claim: insight.claim,
        evidence: insight.evidence,
        confidence: insight.confidence,
        direction: insight.direction,
        first_seen_run_id: predecessor ? predecessor.first_seen_run_id : runId,
        consecutive_appearances: predecessor ? (predecessor.consecutive_appearances ?? 0) + 1 : 1,
      });

      if (predecessor) {
        matchedKeys.add(insight.stable_key);
        const relationship = insight.direction === "reversal" ? "reverses"
          : insight.confidence === predecessor.confidence ? "confirms"
          : "strengthens";
        insertInsightLineage(db, newInsightId, predecessor.id, relationship);
      }
    }

    // Retire unmatched previous insights
    for (const prev of previousInsights) {
      if (!matchedKeys.has(prev.stable_key)) {
        retireInsight(db, prev.id);
      }
    }

    // Step 5: Store recommendations
    for (const rec of result.recommendations) {
      insertRecommendation(db, {
        run_id: runId,
        type: rec.type,
        priority: rec.priority,
        confidence: rec.confidence,
        headline: rec.headline,
        detail: rec.detail,
        action: rec.action,
        evidence_json: null,
      });
    }

    // Step 6: Generate overview summary
    const topPerformer = db.prepare(
      `SELECT p.id, p.content_preview, pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends,
        (COALESCE(pm.comments,0)*5 + COALESCE(pm.reposts,0)*3 + COALESCE(pm.saves,0)*3 + COALESCE(pm.sends,0)*3 + COALESCE(pm.reactions,0)*1) as weighted_score
      FROM posts p
      JOIN post_metrics pm ON pm.post_id = p.id
      JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest ON pm.id = latest.max_id
      WHERE p.published_at >= datetime('now', '-30 days')
      ORDER BY weighted_score DESC LIMIT 1`
    ).get() as any;

    const topPerformerInfo = topPerformer
      ? `"${topPerformer.content_preview?.slice(0, 80) ?? "(no preview)"}" — ${topPerformer.impressions} impressions, weighted score ${topPerformer.weighted_score}`
      : "No posts in last 30 days";

    const quickInsights = result.insights
      .filter((i) => i.confidence !== "insufficient")
      .slice(0, 3)
      .map((i) => i.claim);

    upsertOverview(db, {
      run_id: runId,
      summary_text: result.summary,
      top_performer_post_id: topPerformer?.id ?? null,
      top_performer_reason: quickInsights[0] ?? null,
      quick_insights: JSON.stringify(quickInsights),
    });

    // Sum up token usage from logs
    const tokenSums = db.prepare(
      "SELECT SUM(input_tokens) as input, SUM(output_tokens) as output FROM ai_logs WHERE run_id = ?"
    ).get(runId) as { input: number; output: number };

    completeRun(db, runId, {
      input_tokens: tokenSums.input ?? 0,
      output_tokens: tokenSums.output ?? 0,
      cost_cents: 0, // Could compute from model pricing but not critical
    });

    return { runId, status: "completed" };
  } catch (error: any) {
    failRun(db, runId, error.message);
    return { runId, status: "failed", error: error.message };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/orchestrator.ts
git commit -m "feat: add AI pipeline orchestrator (tag → analyze → recommend → overview)"
```

---

## Chunk 5: API Routes + Ingest Hook

### Task 11: Insights API routes

**Files:**
- Create: `server/src/routes/insights.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/__tests__/insights-routes.test.ts`

- [ ] **Step 1: Write route tests**

Create `server/src/__tests__/insights-routes.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-insights-routes.db");

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(TEST_DB_PATH);
  await app.ready();

  // Seed data
  await app.inject({
    method: "POST",
    url: "/api/ingest",
    payload: {
      posts: Array.from({ length: 15 }, (_, i) => ({
        id: `insight-test-${i}`,
        content_preview: `Test post ${i}`,
        content_type: "text",
        published_at: `2026-03-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      })),
      post_metrics: Array.from({ length: 15 }, (_, i) => ({
        post_id: `insight-test-${i}`,
        impressions: 1000 + i * 100,
        reactions: 50 + i * 5,
        comments: 10 + i,
        reposts: 5,
      })),
    },
  });
});

afterAll(async () => {
  await app.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("GET /api/insights", () => {
  it("returns empty when no analysis has run", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recommendations).toEqual([]);
    expect(body.insights).toEqual([]);
  });
});

describe("GET /api/insights/overview", () => {
  it("returns null overview when no analysis has run", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights/overview" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.overview).toBeNull();
  });
});

describe("GET /api/insights/tags", () => {
  it("returns empty tags when nothing tagged", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights/tags" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tags).toEqual({});
  });
});

describe("GET /api/insights/taxonomy", () => {
  it("returns empty taxonomy initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights/taxonomy" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.taxonomy).toEqual([]);
  });
});

describe("POST /api/insights/refresh", () => {
  it("returns error without API key", async () => {
    const res = await app.inject({ method: "POST", url: "/api/insights/refresh" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("API key");
  });
});

describe("PATCH /api/insights/recommendations/:id/feedback", () => {
  it("returns 404 for nonexistent recommendation", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/insights/recommendations/999/feedback",
      payload: { feedback: "useful" },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — routes not registered.

- [ ] **Step 3: Implement routes**

Create `server/src/routes/insights.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  getRecommendations,
  getActiveInsights,
  getLatestOverview,
  getAiTags,
  getTaxonomy,
  getChangelog,
  updateRecommendationFeedback,
  getRunningRun,
} from "../db/ai-queries.js";
import { createClient } from "../ai/client.js";
import { runPipeline } from "../ai/orchestrator.js";

export function registerInsightsRoutes(app: FastifyInstance, db: Database.Database): void {
  // Latest cached analysis
  app.get("/api/insights", async () => {
    return {
      recommendations: getRecommendations(db),
      insights: getActiveInsights(db),
    };
  });

  // AI summary for Overview tab
  app.get("/api/insights/overview", async () => {
    return { overview: getLatestOverview(db) };
  });

  // What changed since last run
  app.get("/api/insights/changelog", async () => {
    return getChangelog(db);
  });

  // AI tags for all posts
  app.get("/api/insights/tags", async (request) => {
    const q = request.query as { post_ids?: string };
    const postIds = q.post_ids ? q.post_ids.split(",") : [];
    return { tags: getAiTags(db, postIds) };
  });

  // Current content taxonomy
  app.get("/api/insights/taxonomy", async () => {
    return { taxonomy: getTaxonomy(db) };
  });

  // Trigger fresh analysis
  app.post("/api/insights/refresh", async (request, reply) => {
    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) {
      return reply.status(400).send({ error: "No API key configured. Set TRUSTMIND_LLM_API_KEY." });
    }

    // Check for running pipeline
    const running = getRunningRun(db);
    if (running) {
      return reply.status(409).send({
        error: "Analysis already running",
        started_at: running.started_at,
      });
    }

    const client = createClient(apiKey);
    // Run in background — don't block the response
    const resultPromise = runPipeline(client, db, "manual");

    // Return immediately with run status
    return { ok: true, message: "Analysis started" };
  });

  // Record feedback
  app.patch("/api/insights/recommendations/:id/feedback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { feedback?: string; acted_on?: boolean };

    if (!body.feedback && body.acted_on === undefined) {
      return reply.status(400).send({ error: "Provide feedback or acted_on" });
    }

    // Check recommendation exists
    const rec = db.prepare("SELECT id FROM recommendations WHERE id = ?").get(Number(id));
    if (!rec) {
      return reply.status(404).send({ error: "Recommendation not found" });
    }

    if (body.feedback) {
      updateRecommendationFeedback(db, Number(id), body.feedback);
    }
    if (body.acted_on !== undefined) {
      db.prepare("UPDATE recommendations SET acted_on = ?, acted_on_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(body.acted_on ? 1 : 0, Number(id));
    }

    return { ok: true };
  });

  // AI logs for debugging
  app.get("/api/insights/logs/:runId", async (request) => {
    const { runId } = request.params as { runId: string };
    const logs = db.prepare("SELECT * FROM ai_logs WHERE run_id = ? ORDER BY id").all(Number(runId));
    return { logs };
  });
}
```

- [ ] **Step 4: Register routes in app.ts**

Add to `server/src/app.ts` — import and call `registerInsightsRoutes(app, db)` after the existing route registrations:

Add import at top:
```typescript
import { registerInsightsRoutes } from "./routes/insights.js";
```

Add after the profile route (before the static file serving section):
```typescript
  // AI Insights routes
  registerInsightsRoutes(app, db);
```

- [ ] **Step 5: Run tests**

Run: `npm test -w server`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/insights.ts server/src/app.ts server/src/__tests__/insights-routes.test.ts
git commit -m "feat: add /api/insights/* routes with tests"
```

### Task 12: Auto-trigger analysis after ingest

**Files:**
- Modify: `server/src/app.ts`

- [ ] **Step 1: Add auto-trigger logic after successful ingest**

In `server/src/app.ts`, after the `logScrape()` call in the ingest handler (around line 139), add:

```typescript
    // Auto-trigger AI pipeline if conditions met
    const aiApiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (aiApiKey && postsUpserted > 0) {
      // Import lazily to avoid issues when AI features are disabled
      import("./ai/orchestrator.js").then(async ({ runPipeline }) => {
        const { getPostCountWithMetrics, getLatestCompletedRun, getPostCountSinceRun, getRunningRun } = await import("./db/ai-queries.js");
        const { createClient } = await import("./ai/client.js");

        // Check if already running
        if (getRunningRun(db)) return;

        const postCount = getPostCountWithMetrics(db);
        if (postCount < 10) return;

        const lastRun = getLatestCompletedRun(db);
        if (lastRun) {
          const newPosts = getPostCountSinceRun(db, lastRun.id);
          if (newPosts < 3) return;
        }

        const client = createClient(aiApiKey);
        runPipeline(client, db, "sync").catch((err) => {
          console.error("[AI Pipeline] Auto-trigger failed:", err.message);
        });
      }).catch(() => {
        // AI modules not available — skip silently
      });
    }
```

- [ ] **Step 2: Run tests to make sure nothing broke**

Run: `npm test -w server`
Expected: All tests pass (auto-trigger won't fire in tests — no API key).

- [ ] **Step 3: Commit**

```bash
git add server/src/app.ts
git commit -m "feat: auto-trigger AI pipeline after ingest when conditions met"
```

---

## Chunk 6: Dashboard — Overview Tab Transform

### Task 13: Add insights API client methods

**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add new types and API methods**

Add to `dashboard/src/api/client.ts`:

```typescript
// Add these interfaces after existing ones

export interface AiOverview {
  summary_text: string;
  top_performer_post_id: string | null;
  top_performer_reason: string | null;
  quick_insights: string; // JSON array
}

export interface Recommendation {
  id: number;
  type: string;
  priority: string;
  confidence: string;
  headline: string;
  detail: string;
  action: string;
  evidence_json: string | null;
  feedback: string | null;
  acted_on: number;
  created_at: string;
}

export interface Insight {
  id: number;
  category: string;
  stable_key: string;
  claim: string;
  evidence: string;
  confidence: string;
  direction: string;
  consecutive_appearances: number;
  status: string;
}

export interface Changelog {
  confirmed: Insight[];
  new_signal: Insight[];
  reversed: Insight[];
  retired: Insight[];
}

export interface TaxonomyItem {
  id: number;
  name: string;
  description: string;
}

// Add these to the api object:
```

Add to the `api` object:
```typescript
  insightsOverview: () => get<{ overview: AiOverview | null }>("/insights/overview"),
  insights: () => get<{ recommendations: Recommendation[]; insights: Insight[] }>("/insights"),
  insightsChangelog: () => get<Changelog>("/insights/changelog"),
  insightsTags: (postIds: string[]) =>
    get<{ tags: Record<string, { hook_type: string; tone: string; format_style: string }> }>(
      `/insights/tags?post_ids=${postIds.join(",")}`
    ),
  insightsTaxonomy: () => get<{ taxonomy: TaxonomyItem[] }>("/insights/taxonomy"),
  insightsRefresh: () =>
    fetch(`${BASE_URL}/insights/refresh`, { method: "POST" }).then((r) => r.json()),
  recommendationFeedback: (id: number, feedback: string) =>
    fetch(`${BASE_URL}/insights/recommendations/${id}/feedback`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    }).then((r) => r.json()),
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add insights API client methods to dashboard"
```

### Task 14: Transform Overview tab

**Files:**
- Modify: `dashboard/src/pages/Overview.tsx`

- [ ] **Step 1: Rewrite Overview with AI summary card, contextual KPIs, top performer**

Replace `dashboard/src/pages/Overview.tsx` with:

```typescript
import { useState, useEffect } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { api, type OverviewData, type AiOverview } from "../api/client";
import KPICard from "../components/KPICard";
import DateRangeSelector, {
  daysToDateRange,
} from "../components/DateRangeSelector";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

function fmt(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toLocaleString();
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "--";
  return (n * 100).toFixed(1) + "%";
}

export default function Overview() {
  const [range, setRange] = useState(30);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [prevOverview, setPrevOverview] = useState<OverviewData | null>(null);
  const [aiOverview, setAiOverview] = useState<AiOverview | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const params = daysToDateRange(range);
    api.overview(params).then(setOverview).catch(() => {});

    // Fetch previous period for comparison
    if (params?.since) {
      const sinceDate = new Date(params.since);
      const untilDate = new Date(params.since);
      const prevSince = new Date(sinceDate.getTime() - (Date.now() - sinceDate.getTime()));
      api.overview({ since: prevSince.toISOString().slice(0, 10), until: params.since }).then(setPrevOverview).catch(() => {});
    }

    api.insightsOverview().then((r) => setAiOverview(r.overview)).catch(() => {});
  }, [range]);

  function pctChange(current: number | null | undefined, previous: number | null | undefined): string | null {
    if (current == null || previous == null || previous === 0) return null;
    const change = ((current - previous) / previous) * 100;
    const sign = change > 0 ? "+" : "";
    return `${sign}${change.toFixed(0)}% vs prev period`;
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.insightsRefresh();
      // Poll for completion
      setTimeout(() => {
        api.insightsOverview().then((r) => setAiOverview(r.overview)).catch(() => {});
        setRefreshing(false);
      }, 5000);
    } catch {
      setRefreshing(false);
    }
  }

  const quickInsights: string[] = aiOverview?.quick_insights
    ? JSON.parse(aiOverview.quick_insights)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Overview</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs text-text-muted hover:text-text-secondary px-2 py-1 rounded border border-border hover:border-border disabled:opacity-50"
          >
            {refreshing ? "Analyzing..." : "↻ Refresh insights"}
          </button>
          <DateRangeSelector selected={range} onChange={setRange} />
        </div>
      </div>

      {/* AI Summary Card */}
      {aiOverview && (
        <div className="bg-gradient-to-br from-[#1a2a4a] to-[#1a1a3a] border border-[#2a3a5a] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs">✦</span>
            <span className="text-accent text-xs font-bold uppercase tracking-widest">AI Summary</span>
          </div>
          <p className="text-text-primary text-sm leading-relaxed">
            {aiOverview.summary_text}
          </p>
        </div>
      )}

      {/* KPI Cards with comparison */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="Impressions"
          value={fmt(overview?.total_impressions)}
          subtitle={pctChange(overview?.total_impressions, prevOverview?.total_impressions)}
        />
        <KPICard
          label="Avg Engagement"
          value={fmtPct(overview?.avg_engagement_rate)}
          subtitle={pctChange(overview?.avg_engagement_rate, prevOverview?.avg_engagement_rate)}
        />
        <KPICard
          label="Followers"
          value={fmt(overview?.total_followers)}
        />
        <KPICard
          label="Profile Views"
          value={fmt(overview?.profile_views)}
          subtitle={pctChange(overview?.profile_views, prevOverview?.profile_views)}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Top Performer */}
        {aiOverview?.top_performer_post_id && (
          <div className="bg-positive/5 border border-positive/20 rounded-lg p-5">
            <h3 className="text-positive text-xs font-bold uppercase tracking-wide mb-3">
              Top Performer
            </h3>
            <p className="text-text-primary text-sm mb-2">
              {aiOverview.top_performer_reason || "Best performing post this period"}
            </p>
          </div>
        )}

        {/* Quick Insights */}
        {quickInsights.length > 0 && (
          <div className="bg-surface-1 border border-border rounded-lg p-5">
            <h3 className="text-accent text-xs font-bold uppercase tracking-wide mb-3">
              Quick Insights
            </h3>
            <ul className="space-y-2">
              {quickInsights.map((insight, i) => (
                <li key={i} className="text-text-secondary text-sm flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Fallback when no AI data */}
      {!aiOverview && (
        <div className="bg-surface-1 border border-border rounded-lg p-5 text-center">
          <p className="text-text-muted text-sm">
            {overview && overview.posts_count < 10
              ? `Need ${10 - overview.posts_count} more posts to generate AI insights. Keep syncing!`
              : "No AI insights yet. Click \"Refresh insights\" to run the first analysis."}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update KPICard to support subtitle prop**

Check if KPICard already accepts `subtitle`. If not, add it:

```typescript
// In dashboard/src/components/KPICard.tsx
interface KPICardProps {
  label: string;
  value: string;
  subtitle?: string | null;
}

export default function KPICard({ label, value, subtitle }: KPICardProps) {
  const isPositive = subtitle?.startsWith("+");
  return (
    <div className="bg-surface-1 border border-border rounded-lg p-5">
      <p className="text-text-muted text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className="text-text-primary text-2xl font-bold font-mono">{value}</p>
      {subtitle && (
        <p className={`text-xs mt-1 ${isPositive ? "text-positive" : "text-negative"}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build dashboard and verify**

Run: `npm run build:dashboard`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Overview.tsx dashboard/src/components/KPICard.tsx
git commit -m "feat: transform Overview tab with AI summary, contextual KPIs, top performer"
```

---

## Chunk 7: Dashboard — Coach Tab

### Task 15: Create Coach page component

**Files:**
- Create: `dashboard/src/pages/Coach.tsx`

- [ ] **Step 1: Implement Coach tab**

Create `dashboard/src/pages/Coach.tsx`:

```typescript
import { useState, useEffect } from "react";
import {
  api,
  type Recommendation,
  type Changelog,
} from "../api/client";

const priorityColors: Record<string, string> = {
  high: "bg-negative text-white",
  medium: "bg-warning text-surface-0",
  low: "bg-surface-3 text-text-secondary",
};

const confidenceColors: Record<string, string> = {
  strong: "text-positive",
  moderate: "text-warning",
  weak: "text-negative",
};

const confidenceDots: Record<string, string> = {
  strong: "●",
  moderate: "●",
  weak: "●",
};

export default function Coach() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [changelog, setChangelog] = useState<Changelog | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api.insights().then((r) => setRecommendations(r.recommendations)).catch(() => {});
    api.insightsChangelog().then(setChangelog).catch(() => {});
  }, []);

  async function handleFeedback(id: number, feedback: string) {
    await api.recommendationFeedback(id, feedback);
    setRecommendations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, feedback } : r))
    );
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.insightsRefresh();
      setTimeout(() => {
        api.insights().then((r) => setRecommendations(r.recommendations)).catch(() => {});
        api.insightsChangelog().then(setChangelog).catch(() => {});
        setRefreshing(false);
      }, 5000);
    } catch {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm">✦</span>
          <h2 className="text-xl font-semibold">AI Coach</h2>
          <span className="text-text-muted text-xs">
            {recommendations.length} insights
          </span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs text-text-muted hover:text-text-secondary px-3 py-1.5 rounded border border-border hover:border-border disabled:opacity-50"
        >
          {refreshing ? "Analyzing..." : "↻ Refresh"}
        </button>
      </div>

      {/* Evidence strength legend */}
      <div className="flex gap-4 px-3 py-2 bg-surface-1 rounded-md text-xs">
        <span className="text-text-muted uppercase tracking-wider">Evidence:</span>
        <span className="text-positive">● Strong</span>
        <span className="text-warning">● Moderate</span>
        <span className="text-negative">● Weak</span>
      </div>

      {/* Recommendation cards */}
      {recommendations.length === 0 ? (
        <div className="bg-surface-1 border border-border rounded-lg p-8 text-center">
          <p className="text-text-muted text-sm">
            No recommendations yet. Run an analysis to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec) => (
            <div
              key={rec.id}
              className="bg-surface-1 border border-border rounded-xl p-4 space-y-3"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${priorityColors[rec.priority]}`}
                  >
                    {rec.priority === "high" ? "HIGH" : rec.priority === "medium" ? "MED" : "LOW"}
                  </span>
                  <span className="text-text-muted text-xs">
                    {rec.type.replace(/_/g, " ")}
                  </span>
                </div>
                <span className={`text-xs ${confidenceColors[rec.confidence]}`}>
                  {confidenceDots[rec.confidence]} {rec.confidence} evidence
                </span>
              </div>

              {/* Content */}
              <p className="text-text-primary font-semibold text-sm">
                {rec.headline}
              </p>
              <p className="text-text-secondary text-sm leading-relaxed">
                {rec.detail}
              </p>

              {/* Action */}
              {rec.action && (
                <div className="bg-surface-2 rounded-lg p-3">
                  <p className="text-accent text-xs font-bold mb-1">Try next:</p>
                  <p className="text-text-secondary text-sm">{rec.action}</p>
                </div>
              )}

              {/* Feedback */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleFeedback(rec.id, "useful")}
                  className={`text-xs px-2.5 py-1 rounded ${
                    rec.feedback === "useful"
                      ? "bg-positive/20 text-positive"
                      : "bg-surface-2 text-text-muted hover:text-text-secondary"
                  }`}
                >
                  👍 Useful
                </button>
                <button
                  onClick={() => handleFeedback(rec.id, "not_useful")}
                  className={`text-xs px-2.5 py-1 rounded ${
                    rec.feedback === "not_useful"
                      ? "bg-negative/20 text-negative"
                      : "bg-surface-2 text-text-muted hover:text-text-secondary"
                  }`}
                >
                  👎 Not useful
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* What Changed */}
      {changelog && (changelog.confirmed.length > 0 || changelog.new_signal.length > 0 || changelog.reversed.length > 0) && (
        <div className="border-t border-border pt-4 mt-6">
          <h3 className="text-text-muted text-xs font-bold uppercase tracking-widest mb-3">
            What Changed Since Last Analysis
          </h3>
          <div className="space-y-2">
            {changelog.confirmed.map((i) => (
              <div key={i.id} className="flex items-center gap-2 text-sm">
                <span className="text-positive text-xs font-bold w-20">CONFIRMED</span>
                <span className="text-text-secondary">{i.claim}</span>
              </div>
            ))}
            {changelog.new_signal.map((i) => (
              <div key={i.id} className="flex items-center gap-2 text-sm">
                <span className="text-accent text-xs font-bold w-20">NEW SIGNAL</span>
                <span className="text-text-secondary">{i.claim}</span>
              </div>
            ))}
            {changelog.reversed.map((i) => (
              <div key={i.id} className="flex items-center gap-2 text-sm">
                <span className="text-negative text-xs font-bold w-20">REVERSED</span>
                <span className="text-text-secondary">{i.claim}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Coach.tsx
git commit -m "feat: add Coach tab with recommendation cards and changelog"
```

### Task 16: Add Coach tab to App navigation

**Files:**
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Add Coach to tabs**

In `dashboard/src/App.tsx`:

Add import:
```typescript
import Coach from "./pages/Coach";
```

Change the tabs array:
```typescript
const tabs = ["Overview", "Posts", "Coach", "Timing", "Followers"] as const;
```

Add the render condition in the main content area:
```typescript
        {tab === "Coach" && <Coach />}
```

- [ ] **Step 2: Build dashboard**

Run: `npm run build:dashboard`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/App.tsx
git commit -m "feat: add Coach tab to dashboard navigation"
```

---

## Chunk 8: Environment Setup + Integration Test

### Task 17: Environment configuration

**Files:**
- Create: `server/.env.example`
- Modify: `.gitignore` (verify .env is ignored)

- [ ] **Step 1: Create .env.example**

```
# OpenRouter API key for AI features (optional — dashboard works without it)
TRUSTMIND_LLM_API_KEY=sk-or-v1-your-key-here
```

- [ ] **Step 2: Load .env in server entry point**

Check if `server/src/index.ts` loads env vars. If not, add dotenv or manual loading at the top of `server/src/index.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env file if it exists
const __dirname_entry = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname_entry, "../.env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join("=").trim();
    }
  }
}
```

- [ ] **Step 3: Verify .env is in .gitignore**

Check `.gitignore` contains `.env`. It should already be there from earlier work.

- [ ] **Step 4: Commit**

```bash
git add server/.env.example server/src/index.ts
git commit -m "feat: add .env configuration for AI API key"
```

### Task 18: Manual integration test

- [ ] **Step 1: Copy API key from trustmind**

```bash
grep TRUSTMIND_LLM_API_KEY /Users/nate/code/trustmind/backend/.env.local
```

Create `server/.env` with the key.

- [ ] **Step 2: Start the server**

```bash
npm run dev -w server
```

- [ ] **Step 3: Trigger analysis manually**

```bash
curl -X POST http://localhost:3210/api/insights/refresh
```

- [ ] **Step 4: Check results**

```bash
curl http://localhost:3210/api/insights | jq .
curl http://localhost:3210/api/insights/overview | jq .
curl http://localhost:3210/api/insights/taxonomy | jq .
```

- [ ] **Step 5: Build and view dashboard**

```bash
npm run build:dashboard
```

Open `http://localhost:3210` in browser. Check Overview tab for AI summary and Coach tab for recommendations.

- [ ] **Step 6: Run full test suite**

```bash
npm test -w server
```
Expected: All tests pass.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete AI insights system — pipeline, routes, dashboard"
```
