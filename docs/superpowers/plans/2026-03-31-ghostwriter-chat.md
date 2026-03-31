# Ghostwriter Chat Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static combine+review steps with a tool-using conversational agent that interviews the user and iteratively refines a LinkedIn post draft in a split-view chat interface.

**Architecture:** Tool-using agent on the raw Anthropic Messages API (via OpenRouter). The ghostwriter has 6 tools to selectively retrieve context (editorial principles, writing rules, past posts, platform knowledge, author profile) and update the draft. A `while (stop_reason === "tool_use")` loop with a 10-iteration cap and per-call timeouts executes tools server-side. The system prompt is lightweight behavioral instructions — editorial principles drive conversation behavior (asking questions, challenging vagueness) rather than static generation rules. Per-request state objects (not module globals) ensure concurrency safety.

**Tech Stack:** Fastify, Anthropic SDK (`@anthropic-ai/sdk`) via OpenRouter, SQLite (better-sqlite3), React, Tailwind CSS v4

**Important: Verify early that tool_use works through OpenRouter.** This codebase has zero existing tool_use calls. Before building the full loop, test with a single tool call in isolation.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/src/ai/ghostwriter.ts` | Agentic loop, system prompt builder, per-request state |
| `server/src/ai/ghostwriter-tools.ts` | Tool definitions and handler implementations |
| `server/src/ai/platform-knowledge.ts` | Pre-extracted LinkedIn knowledge map (no regex, no runtime file reads) |
| `server/src/db/migrations/024-editorial-principles.sql` | New table for context-indexed editorial principles |
| `dashboard/src/pages/generate/GhostwriterChat.tsx` | Split-view chat UI (chat left, editable draft right) |
| `server/src/__tests__/ghostwriter-tools.test.ts` | Tests for tool handlers |
| `server/src/__tests__/ghostwriter.test.ts` | Tests for agentic loop and system prompt |

### Modified Files
| File | Changes |
|------|---------|
| `server/src/routes/generate.ts` | Add `POST /api/generate/ghostwrite` and `PATCH /api/generate/:id/selection` endpoints |
| `server/src/schemas/generate.ts` | Add `ghostwriteBody` and `selectionBody` schemas |
| `server/src/db/generate-queries.ts` | Add editorial principle queries + auto-pruning |
| `server/src/ai/retro.ts` | Store retro patterns as editorial principles (LLM dedup) |
| `dashboard/src/api/client.ts` | Add `ghostwrite()`, `saveSelection()`, `saveDraft()` API methods |
| `dashboard/src/pages/Generate.tsx` | Wire step 3 to GhostwriterChat, pass onRetro prop |
| `dashboard/src/pages/generate/DraftVariations.tsx` | Persist selection to DB before transitioning |

### Reference Files (read-only)
| File | What to reference |
|------|-------------------|
| `server/src/ai/interviewer-prompt.ts` | Follow-up strategies (SURFACE, ENERGY, CASUAL ASIDE, CONTRADICTION) |
| `server/src/ai/linkedin-knowledge.md` | Source for pre-extracted platform knowledge |
| `docs/ai-insights-research.md` | Source for pre-extracted content strategy research |
| `server/src/ai/prompt-assembler.ts` | Current prompt assembly patterns (rules + insights + profile) |
| `server/src/ai/client.ts` | Model constants, OpenRouter client creation |
| `server/src/ai/stream-with-idle.ts` | Timeout/deadline patterns to follow |
| `dashboard/src/pages/generate/ReviewEdit.tsx` | Existing chat+draft pattern (editable textarea, copy, error handling) |

---

## Chunk 1: Database & Tool Handlers (server foundation)

### Task 1: Editorial Principles Migration

**Files:**
- Create: `server/src/db/migrations/024-editorial-principles.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE editorial_principles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  principle_text TEXT NOT NULL,
  source_post_type TEXT,
  source_context TEXT,
  frequency INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 0.5,
  last_confirmed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_editorial_principles_persona ON editorial_principles(persona_id);
```

- [ ] **Step 2: Verify migration runs on server startup**

Run: `pnpm dev` and check that the server starts without errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/db/migrations/024-editorial-principles.sql
git commit -m "feat: add editorial_principles table for context-indexed principles"
```

### Task 2: Editorial Principle Query Functions

**Files:**
- Modify: `server/src/db/generate-queries.ts`
- Test: `server/src/__tests__/generate-queries.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `generate-queries.test.ts`:

```typescript
describe("editorial principles", () => {
  it("inserts and retrieves principles by persona", () => {
    insertEditorialPrinciple(db, 1, {
      principle_text: "Name real people instead of vague attributions",
      source_post_type: "personal_story",
      source_context: "Retro from post about demo failure",
    });
    const principles = getEditorialPrinciples(db, 1);
    expect(principles).toHaveLength(1);
    expect(principles[0].principle_text).toContain("Name real people");
    expect(principles[0].frequency).toBe(1);
    expect(principles[0].confidence).toBe(0.5);
  });

  it("filters principles by post type when provided", () => {
    insertEditorialPrinciple(db, 1, {
      principle_text: "Close with self-directed claim",
      source_post_type: "personal_story",
      source_context: "Confessional posts land harder with self-reflection",
    });
    insertEditorialPrinciple(db, 1, {
      principle_text: "Lead with a surprising statistic",
      source_post_type: "industry_news",
      source_context: "News posts that open with data get more engagement",
    });
    const personal = getEditorialPrinciples(db, 1, "personal_story");
    expect(personal.length).toBeGreaterThanOrEqual(1);
    expect(personal.every(p => p.source_post_type === "personal_story" || p.source_post_type === null)).toBe(true);
  });

  it("increments frequency and confidence on confirmPrinciple", () => {
    const principles = getEditorialPrinciples(db, 1);
    const id = principles[0].id;
    confirmPrinciple(db, id);
    const updated = getEditorialPrinciples(db, 1);
    const found = updated.find(p => p.id === id)!;
    expect(found.frequency).toBe(2);
    expect(found.confidence).toBeGreaterThan(0.5);
  });

  it("caps confidence at 1.0", () => {
    const principles = getEditorialPrinciples(db, 1);
    const id = principles[0].id;
    for (let i = 0; i < 15; i++) confirmPrinciple(db, id);
    const updated = getEditorialPrinciples(db, 1);
    expect(updated.find(p => p.id === id)!.confidence).toBeLessThanOrEqual(1.0);
  });

  it("prunes stale principles", () => {
    // Insert a low-frequency principle with old timestamp
    db.prepare(`INSERT INTO editorial_principles (persona_id, principle_text, frequency, confidence, created_at)
      VALUES (1, 'Stale one-off principle', 1, 0.5, datetime('now', '-60 days'))`).run();
    const before = getEditorialPrinciples(db, 1);
    pruneStaleEditorialPrinciples(db, 1);
    const after = getEditorialPrinciples(db, 1);
    expect(after.find(p => p.principle_text === "Stale one-off principle")).toBeUndefined();
  });

  it("returns unknown tool gracefully", () => {
    // Belongs in ghostwriter-tools tests but verifies the pattern
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run server/src/__tests__/generate-queries.test.ts`

- [ ] **Step 3: Implement the functions**

Add to `server/src/db/generate-queries.ts`:

```typescript
export interface EditorialPrinciple {
  id: number;
  persona_id: number;
  principle_text: string;
  source_post_type: string | null;
  source_context: string | null;
  frequency: number;
  confidence: number;
  last_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function insertEditorialPrinciple(
  db: Database.Database,
  personaId: number,
  data: { principle_text: string; source_post_type?: string; source_context?: string }
): number {
  const result = db.prepare(
    `INSERT INTO editorial_principles (persona_id, principle_text, source_post_type, source_context)
     VALUES (?, ?, ?, ?)`
  ).run(personaId, data.principle_text, data.source_post_type ?? null, data.source_context ?? null);
  return Number(result.lastInsertRowid);
}

export function getEditorialPrinciples(
  db: Database.Database,
  personaId: number,
  postType?: string
): EditorialPrinciple[] {
  if (postType) {
    return db.prepare(
      `SELECT * FROM editorial_principles
       WHERE persona_id = ? AND (source_post_type = ? OR source_post_type IS NULL)
       ORDER BY confidence DESC, frequency DESC
       LIMIT 10`
    ).all(personaId, postType) as EditorialPrinciple[];
  }
  return db.prepare(
    `SELECT * FROM editorial_principles
     WHERE persona_id = ?
     ORDER BY confidence DESC, frequency DESC
     LIMIT 10`
  ).all(personaId) as EditorialPrinciple[];
}

export function confirmPrinciple(db: Database.Database, id: number): void {
  db.prepare(
    `UPDATE editorial_principles
     SET frequency = frequency + 1,
         confidence = MIN(1.0, confidence + 0.1),
         last_confirmed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(id);
}

/** Remove principles that were seen only once and are older than 30 days */
export function pruneStaleEditorialPrinciples(db: Database.Database, personaId: number): number {
  const result = db.prepare(
    `DELETE FROM editorial_principles
     WHERE persona_id = ? AND frequency <= 1 AND created_at < datetime('now', '-30 days')`
  ).run(personaId);
  return result.changes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run server/src/__tests__/generate-queries.test.ts`

- [ ] **Step 5: Commit**

```bash
git add server/src/db/generate-queries.ts server/src/__tests__/generate-queries.test.ts
git commit -m "feat: editorial principle CRUD with post-type filtering, confirmation, and auto-pruning"
```

### Task 3: Platform Knowledge Map (no regex)

**Files:**
- Create: `server/src/ai/platform-knowledge.ts`

Instead of parsing markdown files with regex at runtime, pre-extract the knowledge into a typed map at build time. Each aspect maps to a plain string of the relevant content. When the knowledge files change, update this map.

- [ ] **Step 1: Create platform-knowledge.ts**

Read `server/src/ai/linkedin-knowledge.md` and `docs/ai-insights-research.md`. Extract each section relevant to the tool's aspects into a `Record<string, string>`:

```typescript
/** Pre-extracted LinkedIn platform knowledge. Updated manually when source docs change. */
export const PLATFORM_KNOWLEDGE: Record<string, string> = {
  hooks: `## Hook Type Analysis
Only the first 210-235 characters are visible before "See more". 60-70% of potential readers are lost at this decision point.

| Hook Type | Description | Strength |
|-----------|-------------|----------|
| Question | Opens with direct question | Drives comments |
| Bold Claim | Contrarian/surprising statement | Stops the scroll |
| Story | "Last Tuesday, I got fired..." | Emotional engagement, dwell time |
| Statistic | Leads with surprising number | Establishes credibility |
| Contrarian | "Unpopular opinion: X is dead" | Polarization drives comments |
| Vulnerable | Admits failure, shares struggle | High saves and follows |`,

  closings: `## Closing Strategies
Close with either a single practitioner question answerable in one sentence from direct experience, or a self-directed claim that stays open.

A question must name one specific thing the reader would have to actively know or have checked to answer it.
A self-directed close ('still thinking about what mine says about me') works when the post is confessional or personal.

The closing is the second most important element after the hook. It determines whether readers comment or scroll past.`,

  length: `## Optimal Post Length
| Length | Performance | Best Use |
|--------|-------------|----------|
| <500 chars | Underperforms | Quick hot takes only |
| 500-900 chars | Good | Engagement drivers, questions |
| 1,300-1,900 chars | **Peak zone** | Deep insight, storytelling |
| >2,000 chars | Diminishing returns | Only if extremely compelling |`,

  format: `## Content Format Performance (2025-2026)
| Format | Avg Engagement Rate | Notes |
|--------|-------------------|-------|
| Multi-image posts | 6.60% | Highest engagement |
| Document carousels | 6.10% | 278% more than video |
| Video | 5.60% | But crashed 35% YoY |
| Text + image | Strong | 58% of all LinkedIn content |
| Text-only | Lowest tier | Unless sharp and compelling |

Single-image posts dropped 30% below text-only in 2026 — LinkedIn's text-only retrieval system can't see images. Substantial captions compensate.`,

  engagement: `## Engagement Quality Hierarchy
| Signal | Approximate Weight | What It Indicates |
|--------|-------------------|-------------------|
| Meaningful comments (15+ words) | ~15x baseline | Provoked genuine thought |
| Shares/Reposts (with context) | ~5x baseline | Worth staking social capital on |
| Saves | ~3x baseline | Lasting reference value |
| Sends (DM shares) | ~3x baseline | High-trust private recommendation |
| Reactions (likes) | 1x baseline | Low-friction; weakest signal |

## Engagement Rate Benchmarks (2026)
- Below 2%: Underperforming
- 2-3.5%: Solid / average
- 3.5-5%: Good
- Above 5%: Exceptional`,

  timing: `## The "Golden Hour"
LinkedIn shows your post to 2-5% of your network in the first 60 minutes. Engagement quality during this window determines platform-wide amplification. Posts maintaining high engagement get distribution for 48-72 hours (up to 1-3 weeks under the 2026 freshness system).

## Posting Frequency
Higher posting frequency = better per-post performance (Buffer, 2M+ posts). No cannibalization. The jump from 1 to 2-5 posts/week is the biggest marginal lift.

Creator reply within 15 minutes gives ~90% boost (GrowLeads). Peak engagement shifted to 3-8 PM in 2026 (Buffer, 4.8M posts).`,

  comments: `## Comments
Comment quality is scored via NLP/ML — not word-count heuristics. A 5-word specific question may score higher than a 50-word generic response.

Threaded conversations (replies to comments) boost reach ~2.4x vs top-level-only comments (AuthoredUp, 621K posts).

Commenter identity matters. Comments from people whose expertise semantically matches the post topic carry more weight.

Pod-like behavior (repetitive phrasing across multiple comments) is specifically detected and devalued.`,

  dwell_time: `## Dwell Time
The P(skip) model is content-type-relative (percentile-based, not absolute seconds). Posts with 61+ seconds dwell time average 15.6% engagement vs 1.2% for 0-3 seconds.

Clicking "see more" is a positive engagement signal that starts/extends the dwell time clock. Posts earning the click AND holding attention past ~15 seconds get a reach multiplier.

Content completion rate matters more than raw engagement.`,

  topic_authority: `## Topic Authority
360Brew requires 60-90 days of consistent posting on 2-3 focused topics before recognizing expertise and optimizing distribution.

The system cross-references post content against the author's profile (headline, about, experience). Content misaligned with stated expertise gets suppressed.

80%+ of content should be within 2-3 core topics for proper classification.`,
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/platform-knowledge.ts
git commit -m "feat: pre-extracted platform knowledge map — no regex, no runtime file reads"
```

### Task 4: Ghostwriter Tool Handlers

**Files:**
- Create: `server/src/ai/ghostwriter-tools.ts`
- Test: `server/src/__tests__/ghostwriter-tools.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/src/__tests__/ghostwriter-tools.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initDatabase } from "../db/index.js";
import fs from "fs";
import path from "path";
import {
  createGhostwriterState,
  executeGhostwriterTool,
  GHOSTWRITER_TOOLS,
  type GhostwriterState,
} from "../ai/ghostwriter-tools.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-ghostwriter-tools.db");
let db: ReturnType<typeof initDatabase>;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
  // Use INSERT OR REPLACE in case initDatabase seeds persona data
  db.prepare("INSERT OR REPLACE INTO author_profile (persona_id, profile_text, profile_json) VALUES (1, 'Security practitioner, builds AI tools', '{}')").run();
});

afterAll(() => {
  db.close();
  try { fs.unlinkSync(TEST_DB_PATH); fs.unlinkSync(TEST_DB_PATH + "-wal"); fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch {}
});

describe("GHOSTWRITER_TOOLS", () => {
  it("exports tool definitions with valid JSON schema", () => {
    expect(GHOSTWRITER_TOOLS.length).toBeGreaterThanOrEqual(5);
    for (const tool of GHOSTWRITER_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema.type).toBe("object");
    }
  });
});

describe("executeGhostwriterTool", () => {
  let state: GhostwriterState;

  beforeEach(() => {
    state = createGhostwriterState("Initial draft text");
  });

  it("get_author_profile returns profile text", () => {
    const result = executeGhostwriterTool(db, 1, "get_author_profile", {}, state);
    expect(result).toContain("Security practitioner");
  });

  it("get_platform_knowledge returns relevant content for each aspect", () => {
    for (const aspect of ["hooks", "closings", "length", "format", "engagement", "timing", "comments", "dwell_time", "topic_authority"]) {
      const result = executeGhostwriterTool(db, 1, "get_platform_knowledge", { aspect }, state);
      expect(result.length).toBeGreaterThan(20);
      expect(result).not.toContain("No knowledge");
    }
  });

  it("lookup_principles returns string (empty or formatted)", () => {
    const result = executeGhostwriterTool(db, 1, "lookup_principles", {}, state);
    expect(typeof result).toBe("string");
  });

  it("update_draft updates per-request state", () => {
    const result = executeGhostwriterTool(db, 1, "update_draft", {
      draft: "New draft text",
      change_summary: "Rewrote the hook",
    }, state);
    expect(result).toContain("Draft updated");
    expect(state.currentDraft).toBe("New draft text");
    expect(state.lastChangeSummary).toBe("Rewrote the hook");
  });

  it("concurrent states don't interfere", () => {
    const state1 = createGhostwriterState("Draft A");
    const state2 = createGhostwriterState("Draft B");
    executeGhostwriterTool(db, 1, "update_draft", { draft: "Updated A", change_summary: "a" }, state1);
    executeGhostwriterTool(db, 1, "update_draft", { draft: "Updated B", change_summary: "b" }, state2);
    expect(state1.currentDraft).toBe("Updated A");
    expect(state2.currentDraft).toBe("Updated B");
  });

  it("search_past_posts returns results or empty message", () => {
    const result = executeGhostwriterTool(db, 1, "search_past_posts", { query: "security" }, state);
    expect(typeof result).toBe("string");
  });

  it("unknown tool returns error string without throwing", () => {
    const result = executeGhostwriterTool(db, 1, "nonexistent_tool", {}, state);
    expect(result).toContain("Unknown tool");
  });

  it("tool execution errors are caught and returned as strings", () => {
    // Force an error by passing invalid DB (closed connection)
    const badDb = initDatabase(TEST_DB_PATH + ".bad");
    badDb.close();
    const result = executeGhostwriterTool(badDb, 1, "get_author_profile", {}, state);
    expect(typeof result).toBe("string");
    // Should not throw — returns error message
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run server/src/__tests__/ghostwriter-tools.test.ts`

- [ ] **Step 3: Implement ghostwriter-tools.ts**

Create `server/src/ai/ghostwriter-tools.ts`. Key design decisions:
- **Per-request state object** instead of module globals — concurrency safe
- **try-catch around every tool handler** — errors return as strings for the AI to handle gracefully
- **Platform knowledge from pre-extracted map** — no regex, no file reads
- **6 tools**: get_author_profile, lookup_principles, lookup_rules (existing generation_rules), search_past_posts, get_platform_knowledge, update_draft
- **Sort columns as prepared statement map** instead of string interpolation

```typescript
import type Database from "better-sqlite3";
import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import { getEditorialPrinciples } from "../db/generate-queries.js";
import { getRules } from "../db/generate-queries.js";
import { getAuthorProfile } from "../db/profile-queries.js";
import { PLATFORM_KNOWLEDGE } from "./platform-knowledge.js";

// ── Per-request state (NOT module-level) ──────────────────
export interface GhostwriterState {
  currentDraft: string;
  lastChangeSummary: string;
}

export function createGhostwriterState(initialDraft: string): GhostwriterState {
  return { currentDraft: initialDraft, lastChangeSummary: "" };
}

// ── Tool definitions ──────────────────────────────────────
export const GHOSTWRITER_TOOLS: Tool[] = [
  {
    name: "get_author_profile",
    description: "Get the author's voice profile — their topics, opinions, mental models, anti-examples, and audience. Call this at conversation start or when you need to check voice alignment.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "lookup_principles",
    description: "Look up editorial principles learned from the author's past revisions. These describe HOW the author likes to write — naming real people, compressing process, closing styles, etc. Filter by post_type for more relevant results.",
    input_schema: {
      type: "object" as const,
      properties: {
        post_type: { type: "string", description: "Optional: personal_story, opinion, industry_news, announcement, etc." },
      },
      required: [],
    },
  },
  {
    name: "lookup_rules",
    description: "Look up the author's manually-managed writing rules. These are user-created guardrails for voice, structure, and anti-AI-tropes.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "search_past_posts",
    description: "Search the author's past LinkedIn posts by topic or pattern. Returns hook text, impressions, engagement rate. Use this to find what worked before on similar topics.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search term to match against post content" },
        sort_by: { type: "string", enum: ["impressions", "engagement_rate", "reactions", "comments"], description: "How to rank results (default: impressions)" },
        limit: { type: "number", description: "Max results to return (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_platform_knowledge",
    description: "Get specific LinkedIn platform knowledge and best practices. Use when you identify a weakness in the draft (weak hook, wrong length, poor format) and need data-backed guidance.",
    input_schema: {
      type: "object" as const,
      properties: {
        aspect: {
          type: "string",
          enum: ["hooks", "closings", "length", "format", "engagement", "timing", "comments", "dwell_time", "topic_authority"],
          description: "Which aspect of LinkedIn best practices to retrieve",
        },
      },
      required: ["aspect"],
    },
  },
  {
    name: "update_draft",
    description: "Update the working draft. Call this whenever you have a concrete revision. Include a brief summary of what changed so the user can see the diff.",
    input_schema: {
      type: "object" as const,
      properties: {
        draft: { type: "string", description: "The full updated draft text" },
        change_summary: { type: "string", description: "Brief summary of what changed (shown to user)" },
      },
      required: ["draft", "change_summary"],
    },
  },
];

// ── Prepared statement map for safe sort columns ──────────
const SORT_QUERIES: Record<string, string> = {
  impressions: "ORDER BY m.impressions DESC NULLS LAST",
  engagement_rate: "ORDER BY m.engagement_rate DESC NULLS LAST",
  reactions: "ORDER BY m.reactions DESC NULLS LAST",
  comments: "ORDER BY m.comments DESC NULLS LAST",
};

// ── Tool dispatcher ───────────────────────────────────────
export function executeGhostwriterTool(
  db: Database.Database,
  personaId: number,
  toolName: string,
  input: Record<string, any>,
  state: GhostwriterState
): string {
  try {
    switch (toolName) {
      case "get_author_profile": {
        const profile = getAuthorProfile(db, personaId);
        return profile?.profile_text ?? "No author profile available. Ask the user about their background and perspective.";
      }
      case "lookup_principles": {
        const principles = getEditorialPrinciples(db, personaId, input.post_type);
        if (principles.length === 0) return "No editorial principles recorded yet. These accumulate as the user runs retros on published posts.";
        return principles.map((p, i) =>
          `${i + 1}. ${p.principle_text} (confidence: ${p.confidence.toFixed(1)}, seen ${p.frequency}x${p.source_post_type ? `, typical for: ${p.source_post_type}` : ""})`
        ).join("\n");
      }
      case "lookup_rules": {
        const rules = getRules(db, personaId).filter(r => r.enabled);
        if (rules.length === 0) return "No writing rules configured.";
        return rules.map(r => `- [${r.category}] ${r.rule_text}`).join("\n");
      }
      case "search_past_posts": {
        const orderClause = SORT_QUERIES[input.sort_by] ?? SORT_QUERIES.impressions;
        const limit = Math.min(input.limit ?? 5, 10);

        const rows = db.prepare(`
          SELECT p.hook_text, p.content_type, p.published_at,
                 m.impressions, m.reactions, m.comments, m.engagement_rate
          FROM posts p
          LEFT JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest ON latest.post_id = p.id
          LEFT JOIN post_metrics m ON m.id = latest.max_id
          WHERE p.persona_id = ? AND (p.hook_text LIKE ? OR p.full_text LIKE ?)
          ${orderClause}
          LIMIT ?
        `).all(personaId, `%${input.query}%`, `%${input.query}%`, limit) as any[];

        if (rows.length === 0) return `No past posts found matching "${input.query}".`;
        return rows.map((r: any) =>
          `- "${(r.hook_text ?? "").slice(0, 100)}" (${r.published_at?.slice(0, 10) ?? "?"}) — ${r.impressions ?? 0} impressions, ${((r.engagement_rate ?? 0) * 100).toFixed(1)}% ER, ${r.reactions ?? 0} reactions, ${r.comments ?? 0} comments`
        ).join("\n");
      }
      case "get_platform_knowledge": {
        return PLATFORM_KNOWLEDGE[input.aspect] ?? `No knowledge available for "${input.aspect}".`;
      }
      case "update_draft": {
        state.currentDraft = input.draft;
        state.lastChangeSummary = input.change_summary;
        return `Draft updated. Change: ${input.change_summary}`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err: any) {
    return `Tool error (${toolName}): ${err.message}`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run server/src/__tests__/ghostwriter-tools.test.ts`

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/ghostwriter-tools.ts server/src/__tests__/ghostwriter-tools.test.ts
git commit -m "feat: ghostwriter tool definitions and handlers with per-request state"
```

---

## Chunk 2: Agentic Loop & System Prompt (server core)

### Task 5: Ghostwriter Agentic Loop

**Files:**
- Create: `server/src/ai/ghostwriter.ts`
- Test: `server/src/__tests__/ghostwriter.test.ts`

- [ ] **Step 1: Write the system prompt builder**

Create `server/src/ai/ghostwriter.ts`. The system prompt is behavioral instructions — it tells the AI HOW to conduct the conversation, not WHAT to write.

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import {
  GHOSTWRITER_TOOLS,
  executeGhostwriterTool,
  createGhostwriterState,
  type GhostwriterState,
} from "./ghostwriter-tools.js";
import { insertGenerationMessage } from "../db/generate-queries.js";
import type { Draft } from "@reachlab/shared";

const MAX_TOOL_ITERATIONS = 10;
const API_TIMEOUT_MS = 120_000; // 2 minutes per API call

function buildGhostwriterSystemPrompt(
  selectedDrafts: Draft[],
  userFeedback: string,
  storyContext: string
): string {
  const draftsBlock = selectedDrafts.map((d, i) =>
    `--- Draft ${i + 1} (${d.type}) ---\nHook: ${d.hook}\n\nBody:\n${d.body}\n\nClosing: ${d.closing}`
  ).join("\n\n");

  return `You are a LinkedIn post ghostwriter working one-on-one with the author. You have tools to look up their voice profile, editorial principles, writing rules, past post performance, and LinkedIn platform best practices. Use them selectively — don't front-load everything.

## Your Process

1. Your FIRST action: call update_draft with a combined draft built from the selected variations and user feedback below. No preamble text before this tool call.
2. After updating the draft, review it critically. Identify the weakest elements — vague claims, anonymous sources, generic closings, untold specifics.
3. Ask ONE targeted question about the most important gap. Not a generic question — a question driven by what THIS draft specifically needs. For example: if the draft says "a colleague told me," ask who. If it describes a failure, ask what specifically broke.
4. When the user answers, revise the draft incorporating their answer, call update_draft, then identify the next gap.
5. Keep going until the draft is specific, concrete, and sounds like the author — not like AI.
6. If the user edits the draft directly (you'll see the current draft in their message), adapt to their changes. Don't revert their edits — build on them.
7. When the user says something like "looks good", "done", or "publish" — acknowledge briefly and stop asking questions.

## Follow-Up Strategy

When the user gives a surface-level answer (generic, abstract):
→ "Can you make that more concrete? What specifically happened?"

When the user shows energy (gets specific, speaks faster):
→ "Say more about that."

When the user drops a casual aside:
→ "Wait — that's interesting. What's behind that?"

When the user's answer contradicts something in the draft:
→ Point out the tension and ask which version is true.

When a thread is exhausted (clear, complete answer):
→ Brief acknowledge, revise the draft, move on.

## Rules

- ONE question at a time. Never ask compound questions.
- Keep your responses SHORT. The draft is the artifact — not your commentary.
- Don't explain what you're about to do. Just do it (call update_draft) and then ask your question.
- When you update the draft, briefly note what changed — one sentence max.
- Use tools proactively. If you're unsure about the author's voice, call get_author_profile. If the hook feels weak, call get_platform_knowledge("hooks"). If a principle might apply, call lookup_principles.
- Don't ask the user things you can look up. Use your tools first.
- The goal is a post the author would actually publish with minimal further editing.

## Starting Material

### Selected Variations
${draftsBlock}

### User's Initial Direction
${userFeedback || "(No specific direction given — combine the strongest elements)"}

### Story Context
${storyContext}

Begin by producing the combined draft now.`;
}
```

- [ ] **Step 2: Write the agentic loop with timeouts and iteration cap**

Continue in `ghostwriter.ts`:

```typescript
export interface GhostwriterTurnResult {
  assistantMessage: string;
  draft: string | null;
  changeSummary: string | null;
  toolsUsed: string[];
  input_tokens: number;
  output_tokens: number;
}

export async function ghostwriterTurn(
  client: Anthropic,
  db: Database.Database,
  personaId: number,
  generationId: number,
  logger: AiLogger,
  messages: Array<{ role: "user" | "assistant"; content: string | any[] }>,
  systemPrompt: string,
  currentDraft: string,
): Promise<GhostwriterTurnResult> {
  const state = createGhostwriterState(currentDraft);
  const toolsUsed: string[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  const apiMessages = [...messages];
  let response: Anthropic.Message;
  let iterations = 0;

  while (true) {
    if (++iterations > MAX_TOOL_ITERATIONS) {
      throw new Error("Ghostwriter exceeded maximum tool iterations");
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      response = await client.messages.create({
        model: MODELS.SONNET,
        max_tokens: 4000,
        system: systemPrompt,
        tools: GHOSTWRITER_TOOLS,
        messages: apiMessages,
      }, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    logger.log({
      step: "ghostwriter_turn",
      model: MODELS.SONNET,
      input_messages: JSON.stringify(apiMessages.slice(-1)),
      output_text: JSON.stringify(response.content),
      tool_calls: response.content.filter(b => b.type === "tool_use").length > 0
        ? JSON.stringify(response.content.filter(b => b.type === "tool_use"))
        : null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: 0,
      duration_ms: Date.now() - start,
    });

    if (response.stop_reason !== "tool_use") break;

    // Execute tool calls
    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolsUsed.push(block.name);
        const result = executeGhostwriterTool(
          db, personaId, block.name, block.input as Record<string, any>, state
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    // Append assistant response + tool results for next iteration
    // Note: tool call/result messages are NOT persisted to DB. Each turn
    // is somewhat stateless regarding tool use — the draft state carries
    // forward via currentDraft, and the conversation text provides context.
    apiMessages.push({ role: "assistant", content: response.content as any });
    apiMessages.push({ role: "user", content: toolResults as any });
  }

  const textBlocks = response.content.filter(b => b.type === "text");
  const assistantMessage = textBlocks.map(b => (b as any).text).join("\n");

  const draftChanged = state.currentDraft !== currentDraft;

  // Persist assistant message
  insertGenerationMessage(db, {
    generation_id: generationId,
    role: "assistant",
    content: assistantMessage,
    draft_snapshot: draftChanged ? state.currentDraft : undefined,
  });

  return {
    assistantMessage,
    draft: draftChanged ? state.currentDraft : null,
    changeSummary: draftChanged ? state.lastChangeSummary : null,
    toolsUsed,
    input_tokens: totalInput,
    output_tokens: totalOutput,
  };
}

export { buildGhostwriterSystemPrompt };
```

- [ ] **Step 3: Write tests**

Create `server/src/__tests__/ghostwriter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildGhostwriterSystemPrompt } from "../ai/ghostwriter.js";
import type { Draft } from "@reachlab/shared";

const mockDrafts: Draft[] = [
  { type: "contrarian", hook: "AI security is a joke", body: "Here's why...", closing: "What do you think?", word_count: 50, structure_label: "Contrarian take" },
  { type: "operator", hook: "Last week I built...", body: "The process was...", closing: "Still figuring it out.", word_count: 60, structure_label: "Practitioner view" },
];

describe("buildGhostwriterSystemPrompt", () => {
  it("includes selected drafts in the prompt", () => {
    const prompt = buildGhostwriterSystemPrompt(mockDrafts, "Make it more personal", "AI security research story");
    expect(prompt).toContain("AI security is a joke");
    expect(prompt).toContain("Last week I built");
    expect(prompt).toContain("Make it more personal");
    expect(prompt).toContain("AI security research story");
  });

  it("includes behavioral instructions and follow-up strategies", () => {
    const prompt = buildGhostwriterSystemPrompt(mockDrafts, "", "");
    expect(prompt).toContain("ONE question at a time");
    expect(prompt).toContain("update_draft");
    expect(prompt).toContain("Follow-Up Strategy");
    expect(prompt).toContain("FIRST action");
  });

  it("handles empty feedback gracefully", () => {
    const prompt = buildGhostwriterSystemPrompt(mockDrafts, "", "story");
    expect(prompt).toContain("No specific direction given");
  });

  it("instructs AI to respect user's direct edits", () => {
    const prompt = buildGhostwriterSystemPrompt(mockDrafts, "", "");
    expect(prompt).toContain("edits the draft directly");
    expect(prompt).toContain("Don't revert");
  });

  it("instructs AI to handle conversation termination", () => {
    const prompt = buildGhostwriterSystemPrompt(mockDrafts, "", "");
    expect(prompt).toContain("looks good");
    expect(prompt).toContain("stop asking questions");
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- --run server/src/__tests__/ghostwriter.test.ts`

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/ghostwriter.ts server/src/__tests__/ghostwriter.test.ts
git commit -m "feat: ghostwriter agentic loop with timeouts, iteration cap, and behavioral system prompt"
```

### Task 6: API Endpoints

**Files:**
- Modify: `server/src/routes/generate.ts`
- Modify: `server/src/schemas/generate.ts`
- Test: `server/src/__tests__/generate-routes.test.ts`

- [ ] **Step 1: Add schemas**

Add to `server/src/schemas/generate.ts`:

```typescript
export const ghostwriteBody = z.object({
  generation_id: z.number().int().positive(),
  message: z.string().trim().min(1),
  current_draft: z.string().optional(), // Sent when user has directly edited the draft
});

export const selectionBody = z.object({
  selected_draft_indices: z.array(z.number().int().min(0)),
  combining_guidance: z.string().optional(),
});
```

- [ ] **Step 2: Add the selection persistence endpoint**

This is a lightweight PATCH that saves the user's draft selection before transitioning to the ghostwriter. Add to `server/src/routes/generate.ts`:

```typescript
app.patch("/api/generate/:id/selection", async (request, reply) => {
  const id = Number((request.params as any).id);
  if (isNaN(id)) return reply.status(400).send({ error: "Invalid id" });

  const { selected_draft_indices, combining_guidance } = validateBody(selectionBody, request.body);

  updateGeneration(db, id, {
    selected_draft_indices: JSON.stringify(selected_draft_indices),
    ...(combining_guidance !== undefined ? { combining_guidance } : {}),
  });

  return { ok: true };
});
```

- [ ] **Step 3: Add the ghostwrite endpoint**

Import `ghostwriterTurn`, `buildGhostwriterSystemPrompt` from `../ai/ghostwriter.js`. Import `ghostwriteBody`, `selectionBody` from schemas. Add after the chat endpoint:

```typescript
app.post("/api/generate/ghostwrite", async (request, reply) => {
  const personaId = getPersonaId(request);
  const { generation_id, message, current_draft } = validateBody(ghostwriteBody, request.body);

  const gen = getGeneration(db, generation_id);
  if (!gen) return reply.status(404).send({ error: "Generation not found" });

  const client = getClient();
  const runId = createRun(db, personaId, "ghostwriter", 0);
  const logger = new AiLogger(db, runId);

  try {
    // Persist user message
    insertGenerationMessage(db, { generation_id, role: "user", content: message });

    // Load conversation history
    const history = getGenerationMessages(db, generation_id, 40).reverse();
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const msg of history) {
      messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
    }

    // Build system prompt from generation context
    const drafts: Draft[] = gen.drafts_json ? JSON.parse(gen.drafts_json) : [];
    const selectedIndices: number[] = gen.selected_draft_indices ? JSON.parse(gen.selected_draft_indices) : [];
    const selectedDrafts = selectedIndices.map(i => drafts[i]).filter(Boolean);
    const research = gen.research_id ? getResearch(db, gen.research_id) : null;
    const stories: Story[] = research?.stories_json ? JSON.parse(research.stories_json) : [];
    const story = gen.selected_story_index != null ? stories[gen.selected_story_index] : null;
    const storyContext = story ? `**${story.headline}**\n${story.summary}` : "";

    const isFirstTurn = history.length <= 1;
    const systemPrompt = buildGhostwriterSystemPrompt(
      selectedDrafts.length > 0 ? selectedDrafts : drafts,
      isFirstTurn ? (gen.combining_guidance ?? message) : "",
      storyContext
    );

    // Use user's local edits if provided, otherwise use persisted draft
    const activeDraft = current_draft ?? gen.final_draft ?? "";

    const result = await ghostwriterTurn(
      client, db, personaId, generation_id, logger,
      messages, systemPrompt, activeDraft
    );

    // Persist draft update
    if (result.draft) {
      updateGeneration(db, generation_id, { final_draft: result.draft });
    }

    completeRun(db, runId, getRunCost(db, runId));

    return {
      message: result.assistantMessage,
      draft: result.draft,
      change_summary: result.changeSummary,
      tools_used: result.toolsUsed,
    };
  } catch (err: any) {
    failRun(db, runId, err.message);
    return reply.status(500).send({ error: err.message });
  }
});
```

- [ ] **Step 4: Add tests**

```typescript
describe("PATCH /api/generate/:id/selection", () => {
  it("returns 400 for invalid id", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/generate/abc/selection", payload: { selected_draft_indices: [0] } });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/generate/ghostwrite", () => {
  it("returns 404 for nonexistent generation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/ghostwrite",
      payload: { generation_id: 99999, message: "Make it shorter" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("validates message is required", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/ghostwrite",
      payload: { generation_id: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 5: Run tests, type-check**

Run: `pnpm test -- --run server/src/__tests__/generate-routes.test.ts`
Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/generate.ts server/src/schemas/generate.ts server/src/__tests__/generate-routes.test.ts
git commit -m "feat: ghostwrite and selection endpoints with tool-use agentic loop"
```

---

## Chunk 3: Dashboard — API Client & Chat UI

### Task 7: API Client Methods

**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add types and API methods**

```typescript
export interface GhostwriteResponse {
  message: string;
  draft: string | null;
  change_summary: string | null;
  tools_used: string[];
}
```

Add to the `api` object:

```typescript
ghostwrite: (generationId: number, message: string, currentDraft?: string) =>
  fetch(withPersonaId(`/api/generate/ghostwrite`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: generationId,
      message,
      ...(currentDraft !== undefined ? { current_draft: currentDraft } : {}),
    }),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<GhostwriteResponse>;
  }),

saveSelection: (generationId: number, selectedDraftIndices: number[], combiningGuidance?: string) =>
  fetch(withPersonaId(`/api/generate/${generationId}/selection`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selected_draft_indices: selectedDraftIndices, combining_guidance: combiningGuidance }),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json();
  }),

saveDraft: (generationId: number, draft: string) =>
  fetch(withPersonaId(`/api/generate/${generationId}/draft`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ final_draft: draft }),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json();
  }),
```

Note: `saveDraft` needs a corresponding PATCH endpoint. Add to `server/src/routes/generate.ts`:

```typescript
app.patch("/api/generate/:id/draft", async (request, reply) => {
  const id = Number((request.params as any).id);
  if (isNaN(id)) return reply.status(400).send({ error: "Invalid id" });
  const body = request.body as any;
  if (!body?.final_draft || typeof body.final_draft !== "string") {
    return reply.status(400).send({ error: "final_draft required" });
  }
  updateGeneration(db, id, { final_draft: body.final_draft });
  return { ok: true };
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --project dashboard/tsconfig.json`
Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/api/client.ts server/src/routes/generate.ts
git commit -m "feat: ghostwrite, saveSelection, and saveDraft API client methods"
```

### Task 8: GhostwriterChat Component

**Files:**
- Create: `dashboard/src/pages/generate/GhostwriterChat.tsx`

Split-view: chat left, **editable** draft right. Draft auto-saves on a debounce. Change highlighting on AI updates. Error display. PostRetro accessible.

- [ ] **Step 1: Create the component**

Key design decisions:
- **Editable textarea** for the draft, not read-only. Auto-resizes.
- **Debounced auto-save** — saves to DB 1.5s after the user stops typing. Uses `api.saveDraft()`.
- **When sending a message, include current local draft** — so the AI sees any direct edits the user made.
- **StrictMode-safe auto-start** — uses a ref guard to prevent double-fire.
- **Error state displayed in UI** — not just console.error.
- **PostRetro button** in the draft footer.
- **Copy and Open in LinkedIn** buttons.

The component follows the same patterns as `ReviewEdit.tsx` (editable textarea, optimistic messages, chat history scroll, error display) but with split layout and auto-save.

```typescript
import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../../api/client";

interface GhostwriterChatProps {
  gen: {
    generationId: number | null;
    finalDraft: string;
    chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
    combiningGuidance: string;
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onBack: () => void;
  onRetro?: () => void;
}
```

Local state needed:
```typescript
const [chatInput, setChatInput] = useState("");
const [localDraft, setLocalDraft] = useState(gen.finalDraft);
const [error, setError] = useState<string | null>(null);
const [copied, setCopied] = useState(false);
const [draftVersion, setDraftVersion] = useState(0); // for change animation
const startedRef = useRef(false);
const chatEndRef = useRef<HTMLDivElement>(null);
const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
```

Auto-save debounce:
```typescript
const debouncedSave = useCallback((draft: string) => {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(() => {
    if (gen.generationId) {
      api.saveDraft(gen.generationId, draft).catch(() => {});
    }
  }, 1500);
}, [gen.generationId]);

const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  setLocalDraft(e.target.value);
  debouncedSave(e.target.value);
};
```

Sync local draft when AI updates it:
```typescript
useEffect(() => {
  setLocalDraft(gen.finalDraft);
  setDraftVersion(v => v + 1);
}, [gen.finalDraft]);
```

StrictMode-safe auto-start:
```typescript
useEffect(() => {
  if (gen.generationId && gen.chatMessages.length === 0 && !startedRef.current) {
    startedRef.current = true;
    const initialMessage = gen.combiningGuidance?.trim()
      ? gen.combiningGuidance
      : "Combine these drafts into a single strong post.";
    sendMessage(initialMessage);
  }
}, [gen.generationId]);
```

sendMessage includes local draft edits:
```typescript
const sendMessage = async (message: string) => {
  if (!gen.generationId || !message.trim() || loading) return;
  setLoading(true);
  setError(null);

  setGen((prev: any) => ({
    ...prev,
    chatMessages: [...prev.chatMessages, { role: "user", content: message.trim() }],
  }));

  try {
    const draftChanged = localDraft !== gen.finalDraft;
    const res = await api.ghostwrite(
      gen.generationId,
      message.trim(),
      draftChanged ? localDraft : undefined
    );

    setGen((prev: any) => ({
      ...prev,
      finalDraft: res.draft ?? prev.finalDraft,
      chatMessages: [...prev.chatMessages, {
        role: "assistant",
        content: res.message,
      }],
    }));
    setChatInput("");
  } catch (err: any) {
    setError(err.message ?? "Failed to get response. Try again.");
    setGen((prev: any) => ({
      ...prev,
      chatMessages: prev.chatMessages.slice(0, -1),
    }));
  } finally {
    setLoading(false);
  }
};
```

Layout structure:
- Outer: `flex min-h-[70vh]`
- Left chat panel: `w-1/2 border-r border-gen-border-1 flex flex-col`
  - Scrollable message area: `flex-1 overflow-y-auto p-4 space-y-3`
  - Input area at bottom: `border-t border-gen-border-1 p-3`
  - Error banner above input when `error` is set
- Right draft panel: `w-1/2 flex flex-col`
  - Editable textarea: `flex-1 p-6 font-serif-gen text-[16px] leading-relaxed text-gen-text-0 bg-transparent resize-none border-none focus:outline-none`
  - Footer: `border-t border-gen-border-1 px-6 py-3 flex items-center justify-between`
    - Left: word count (tabular-nums), onRetro button
    - Right: Copy button, Open in LinkedIn button

Auto-scroll chat on new messages:
```typescript
useEffect(() => {
  chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [gen.chatMessages]);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --project dashboard/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/generate/GhostwriterChat.tsx
git commit -m "feat: GhostwriterChat — split-view with editable draft, auto-save, error handling"
```

### Task 9: Wire Into Generate Flow

**Files:**
- Modify: `dashboard/src/pages/Generate.tsx`
- Modify: `dashboard/src/pages/generate/DraftVariations.tsx`

- [ ] **Step 1: Update Generate.tsx**

Import `GhostwriterChat` and replace step 3:

```typescript
import GhostwriterChat from "./generate/GhostwriterChat";
```

Change the step 3 render block:

```typescript
{subTab === "Generate" && step === 3 && (
  <GhostwriterChat
    gen={gen}
    setGen={setGen}
    loading={loading}
    setLoading={setLoading}
    onBack={() => setStep(2)}
    onRetro={() => setStep(4)}
  />
)}
```

- [ ] **Step 2: Update DraftVariations to persist selection before advancing**

Replace `handleCombineAndReview` to persist to DB first:

```typescript
const handleCombineAndReview = async () => {
  if (gen.generationId === null || selectedCount === 0) return;
  setLoading(true);
  try {
    // Persist selection to DB so ghostwriter endpoint can read it
    await api.saveSelection(
      gen.generationId,
      gen.selectedDraftIndices,
      reviseFeedback || gen.combiningGuidance || undefined
    );
    setGen((prev: any) => ({
      ...prev,
      combiningGuidance: reviseFeedback || prev.combiningGuidance,
    }));
    onNext();
  } catch (err) {
    console.error("Failed to save selection:", err);
  } finally {
    setLoading(false);
  }
};
```

- [ ] **Step 3: Type-check both projects**

Run: `npx tsc --noEmit --project dashboard/tsconfig.json`
Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 4: Manual smoke test**

1. `pnpm dev`
2. Generate tab → pick topic → generate drafts
3. Select 1-2 drafts, add guidance
4. Click "Combine & review" → should enter ghostwriter chat
5. AI produces combined draft on right, asks a question on left
6. Answer → draft updates with fade animation
7. Directly edit the draft text → auto-saves after 1.5s
8. Send another message → AI sees your edits and builds on them
9. Click Copy, click Open in LinkedIn
10. Click "Run retro" (if post is published)

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/Generate.tsx dashboard/src/pages/generate/DraftVariations.tsx
git commit -m "feat: wire ghostwriter chat into generate flow — persist selection, pass onRetro"
```

---

## Chunk 4: Retro Integration & Polish

### Task 10: LLM-Based Principle Deduplication

**Files:**
- Modify: `server/src/ai/retro.ts`

Instead of brittle substring matching, use the LLM (Haiku — cheap and fast) to determine if a new principle is semantically similar to an existing one.

- [ ] **Step 1: Implement LLM dedup**

```typescript
import { insertEditorialPrinciple, getEditorialPrinciples, confirmPrinciple } from "../db/generate-queries.js";

export async function storeRetroAsPrinciples(
  client: Anthropic,
  db: Database.Database,
  personaId: number,
  analysis: RetroAnalysis,
  postCategory?: string
): Promise<void> {
  const existing = getEditorialPrinciples(db, personaId);

  for (const pattern of analysis.patterns) {
    if (existing.length === 0) {
      insertEditorialPrinciple(db, personaId, {
        principle_text: pattern,
        source_post_type: postCategory,
        source_context: analysis.summary,
      });
      continue;
    }

    // Use Haiku to check semantic similarity — cheap (~0.001 cents per check)
    const existingList = existing.map((p, i) => `${i + 1}. ${p.principle_text}`).join("\n");
    const { text } = await streamWithIdleTimeout(client, {
      model: MODELS.HAIKU,
      max_tokens: 50,
      messages: [{
        role: "user",
        content: `Does this new editorial principle duplicate any existing one? Answer with just the number of the matching principle, or "none".

New: "${pattern}"

Existing:
${existingList}`,
      }],
    });

    const matchNum = parseInt(text.trim());
    if (!isNaN(matchNum) && matchNum >= 1 && matchNum <= existing.length) {
      confirmPrinciple(db, existing[matchNum - 1].id);
    } else {
      insertEditorialPrinciple(db, personaId, {
        principle_text: pattern,
        source_post_type: postCategory,
        source_context: analysis.summary,
      });
    }
  }
}
```

- [ ] **Step 2: Call from retro route**

In the retro endpoint handler in `server/src/routes/generate.ts`, after `analyzeRetro` succeeds:

```typescript
// Store editorial principles (fire-and-forget — don't block the response)
import("../ai/retro.js").then(({ storeRetroAsPrinciples }) =>
  storeRetroAsPrinciples(client, db, personaId, result.analysis, gen.post_type)
    .catch(err => console.error("[Retro] Failed to store principles:", err))
);
```

- [ ] **Step 3: Add auto-pruning call**

Add to the retro route, before storing new principles:

```typescript
import { pruneStaleEditorialPrinciples } from "../db/generate-queries.js";
pruneStaleEditorialPrinciples(db, personaId);
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/retro.ts server/src/routes/generate.ts
git commit -m "feat: LLM-based principle dedup via Haiku, auto-pruning of stale principles"
```

### Task 11: Final Type-Check & Integration Test

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Run: `npx tsc --noEmit --project dashboard/tsconfig.json`

- [ ] **Step 2: Run all tests**

Run: `pnpm test`

- [ ] **Step 3: Full smoke test**

1. Start fresh: `pnpm dev`
2. Complete the full flow: discover → research → drafts → select → ghostwriter chat
3. Have a 3-4 turn conversation in the chat
4. Verify the draft improves with each turn
5. Directly edit the draft mid-conversation — verify auto-save and AI adapts
6. Copy the draft and verify it's publishable
7. Run a retro on a published post — verify principles are stored with LLM dedup
8. Start a new generation — verify `lookup_principles` returns stored principles
9. Verify `lookup_rules` returns the user's existing generation_rules
10. Check Generation History shows the ghostwriter session correctly
11. Refresh mid-conversation — verify restore puts you back in the chat

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: ghostwriter chat — complete integration with all fixes"
```

---

## Audit Findings — Required Modifications

The following issues were found by review agents after the initial plan was written. They modify specific tasks above and MUST be applied during implementation.

### AF-1: Persona ownership check on ghostwrite endpoint (HIGH — modifies Task 6)

The `getGeneration(db, id)` query has no persona filter. A request with persona 2 can read/write persona 1's generation. This is a pre-existing bug in the chat endpoint too.

**Apply in Task 6, Step 3 (ghostwrite route):** After loading the generation, add:
```typescript
if ((gen as any).persona_id !== personaId) {
  return reply.status(403).send({ error: "Not authorized for this generation" });
}
```
Also apply to the existing `/api/generate/chat` endpoint and the new `PATCH /api/generate/:id/selection` and `PATCH /api/generate/:id/draft` endpoints.

### AF-2: Concurrent request lock per generation_id (HIGH — modifies Task 6)

Two simultaneous ghostwrite requests for the same generation corrupt message history and draft.

**Apply in Task 6, Step 3:** Add an in-memory lock at the top of the route file:
```typescript
const activeGhostwriteRequests = new Set<number>();
```
In the handler, before processing:
```typescript
if (activeGhostwriteRequests.has(generation_id)) {
  return reply.status(429).send({ error: "A ghostwrite request is already in progress for this generation" });
}
activeGhostwriteRequests.add(generation_id);
try {
  // ... existing logic
} finally {
  activeGhostwriteRequests.delete(generation_id);
}
```

### AF-3: Persist user message AFTER success, not before (HIGH — modifies Task 6)

The plan persists the user message to DB before the agentic loop. If the loop fails, the message is orphaned. On retry, it's duplicated.

**Apply in Task 6, Step 3:** Move `insertGenerationMessage` for the user message to AFTER the agentic loop succeeds, in the same block where the assistant message is persisted:
```typescript
// After ghostwriterTurn succeeds:
insertGenerationMessage(db, { generation_id, role: "user", content: message });
// The assistant message is already persisted inside ghostwriterTurn
```

### AF-4: Per-turn token budget (HIGH — modifies Task 5)

10 iterations of growing context can cost $2-5 per turn.

**Apply in Task 5, Step 2 (agentic loop):** Add after the token accumulator:
```typescript
const MAX_TURN_INPUT_TOKENS = 80_000;
if (totalInput > MAX_TURN_INPUT_TOKENS) {
  // Force the model to respond without more tools by breaking
  break;
}
```

### AF-5: Consistent message history limits (MEDIUM — modifies Task 6)

Route loads 40 messages, restore loads 20. AI sees context the user can't see.

**Apply in Task 6, Step 3:** Use limit 20 (matching restore), or update the restore endpoint to use 40. Consistency matters more than the specific number.

### AF-6: Set `originalDraft` from first ghostwriter response (MEDIUM — modifies Task 8)

PostRetro needs `originalDraft` to compare against published text. It's never set in the ghostwriter flow.

**Apply in Task 8, Step 1 (GhostwriterChat sendMessage):** When receiving the first response that includes a draft:
```typescript
setGen((prev: any) => ({
  ...prev,
  originalDraft: prev.originalDraft || res.draft || prev.originalDraft,
  finalDraft: res.draft ?? prev.finalDraft,
  chatMessages: [...prev.chatMessages, assistantMsg],
}));
```

### AF-7: Validate `update_draft` input (MEDIUM — modifies Task 4)

Model can pass empty string, wiping the draft.

**Apply in Task 4, Step 3 (update_draft handler):**
```typescript
case "update_draft": {
  if (!input.draft || typeof input.draft !== "string" || input.draft.trim().length < 10) {
    return "Error: draft must be at least 10 characters. Provide the full draft text.";
  }
  state.currentDraft = input.draft;
  state.lastChangeSummary = input.change_summary ?? "";
  return `Draft updated. Change: ${input.change_summary}`;
}
```

### AF-8: Validate tool_use blocks before processing (MEDIUM — modifies Task 5)

Missing `block.id` causes cryptic SDK errors.

**Apply in Task 5, Step 2 (tool execution loop):**
```typescript
for (const block of response.content) {
  if (block.type === "tool_use") {
    if (!block.id || typeof block.name !== "string") continue; // skip malformed
    toolsUsed.push(block.name);
    // ...
  }
}
```

### AF-9: Back-navigation clears chat state (MEDIUM — modifies Task 9)

Going back to DraftVariations and re-entering creates stale conversation mixed with new context.

**Apply in Task 9, Step 1 (Generate.tsx):** When GhostwriterChat's `onBack` fires, clear the conversation:
```typescript
onBack={() => {
  setGen((prev: any) => ({
    ...prev,
    finalDraft: "",
    originalDraft: "",
    chatMessages: [],
  }));
  setStep(2);
}}
```

### AF-10: Set sentinel `final_draft` when entering step 3 (MEDIUM — modifies Task 9)

If the AI asks a question before drafting, `final_draft` is null and restore breaks.

**Apply in Task 9, Step 2 (DraftVariations handleCombineAndReview):** After persisting selection, set a sentinel:
```typescript
// Set sentinel final_draft so restore works even if AI asks before drafting
const firstDraft = gen.drafts[gen.selectedDraftIndices[0]];
if (firstDraft) {
  const sentinel = `${firstDraft.hook}\n\n${firstDraft.body}\n\n${firstDraft.closing}`;
  await api.saveDraft(gen.generationId, sentinel);
  setGen((prev: any) => ({ ...prev, finalDraft: sentinel, originalDraft: sentinel }));
}
```

### AF-11: Initialize `reviseFeedback` from gen state (MEDIUM — modifies Task 9)

On remount, the local state resets to empty but `gen.combiningGuidance` retains the old value.

**Apply in DraftVariations:** Change initialization:
```typescript
const [reviseFeedback, setReviseFeedback] = useState(gen.combiningGuidance ?? "");
```

### AF-12: Escape LIKE wildcards in search_past_posts (LOW — modifies Task 4)

AI-generated search terms containing `%` or `_` produce wrong results.

**Apply in Task 4, Step 3 (search_past_posts handler):**
```typescript
const escaped = input.query.replace(/%/g, "\\%").replace(/_/g, "\\_");
// Use ESCAPE clause in the query:
// WHERE ... p.hook_text LIKE ? ESCAPE '\\' OR p.full_text LIKE ? ESCAPE '\\'
```
Pass `%${escaped}%` as the parameter.

### AF-13: Simplified system prompt after first turn (LOW — modifies Task 6)

After turn 1, the original draft variations in the system prompt are stale and waste tokens.

**Apply in Task 6, Step 3:** When `isFirstTurn` is false, build a shorter system prompt that omits the draft variations and only includes behavioral instructions + story context. The current working draft is already in the conversation via the user's message or `current_draft` parameter.
