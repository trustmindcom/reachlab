# Ghostwriter Chat Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static combine+review steps with a tool-using conversational agent that interviews the user and iteratively refines a LinkedIn post draft in a split-view chat interface.

**Architecture:** Tool-using agent on the raw Anthropic Messages API (via OpenRouter). The ghostwriter has 5 tools to selectively retrieve context (editorial principles, past posts, platform knowledge, author profile) and update the draft. A `while (stop_reason === "tool_use")` loop executes tools server-side. The system prompt is lightweight behavioral instructions — editorial principles drive conversation behavior (asking questions, challenging vagueness) rather than static generation rules.

**Tech Stack:** Fastify, Anthropic SDK (`@anthropic-ai/sdk`) via OpenRouter, SQLite (better-sqlite3), React, Tailwind CSS v4

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/src/ai/ghostwriter.ts` | Tool definitions, agentic loop, system prompt builder |
| `server/src/ai/ghostwriter-tools.ts` | Tool handler implementations (DB queries, knowledge lookup) |
| `server/src/db/migrations/024-editorial-principles.sql` | New table for context-indexed editorial principles |
| `dashboard/src/pages/generate/GhostwriterChat.tsx` | Split-view chat UI (chat left, draft right) |
| `server/src/__tests__/ghostwriter-tools.test.ts` | Tests for tool handlers |
| `server/src/__tests__/ghostwriter.test.ts` | Tests for agentic loop and system prompt |

### Modified Files
| File | Changes |
|------|---------|
| `server/src/routes/generate.ts` | Add `POST /api/generate/ghostwrite` endpoint |
| `server/src/schemas/generate.ts` | Add `ghostwriteBody` schema |
| `server/src/db/generate-queries.ts` | Add editorial principle queries |
| `dashboard/src/api/client.ts` | Add `ghostwrite()` API method and types |
| `dashboard/src/pages/Generate.tsx` | Wire step 3 to GhostwriterChat instead of ReviewEdit |
| `dashboard/src/pages/generate/DraftVariations.tsx` | Transition to ghostwriter chat on combine |

### Reference Files (read-only)
| File | What to reference |
|------|-------------------|
| `server/src/ai/interviewer-prompt.ts` | Follow-up strategies (SURFACE, ENERGY, CASUAL ASIDE, CONTRADICTION) |
| `server/src/ai/linkedin-knowledge.md` | Platform knowledge to serve via `get_platform_knowledge` tool |
| `server/src/ai/prompt-assembler.ts` | Current prompt assembly patterns |
| `server/src/ai/stream-with-idle.ts` | Existing streaming wrapper to build on |
| `server/src/ai/client.ts` | Model constants, OpenRouter client creation |
| `docs/ai-insights-research.md` | Content strategy research for platform knowledge tool |

---

## Chunk 1: Database & Tool Handlers (server foundation)

### Task 1: Editorial Principles Migration

**Files:**
- Create: `server/src/db/migrations/024-editorial-principles.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE editorial_principles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL,
  principle_text TEXT NOT NULL,
  source_post_type TEXT,
  source_context TEXT,
  frequency INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 0.5,
  last_confirmed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  it("increments frequency on confirmPrinciple", () => {
    const principles = getEditorialPrinciples(db, 1);
    const id = principles[0].id;
    confirmPrinciple(db, id);
    const updated = getEditorialPrinciples(db, 1);
    const found = updated.find(p => p.id === id)!;
    expect(found.frequency).toBe(2);
    expect(found.confidence).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run server/src/__tests__/generate-queries.test.ts`
Expected: FAIL — functions not defined

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
         last_confirmed_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run server/src/__tests__/generate-queries.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/db/generate-queries.ts server/src/__tests__/generate-queries.test.ts
git commit -m "feat: editorial principle CRUD with post-type filtering and confirmation"
```

### Task 3: Ghostwriter Tool Handlers

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
import { executeGhostwriterTool, GHOSTWRITER_TOOLS } from "../ai/ghostwriter-tools.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-ghostwriter-tools.db");
let db: ReturnType<typeof initDatabase>;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
  // Seed some test data
  db.prepare("INSERT INTO author_profile (persona_id, profile_text) VALUES (1, 'Security practitioner, builds AI tools')").run();
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
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    }
  });
});

describe("executeGhostwriterTool", () => {
  it("get_author_profile returns profile text", () => {
    const result = executeGhostwriterTool(db, 1, "get_author_profile", {});
    expect(result).toContain("Security practitioner");
  });

  it("get_platform_knowledge returns relevant section", () => {
    const result = executeGhostwriterTool(db, 1, "get_platform_knowledge", { aspect: "hooks" });
    expect(result).toContain("hook");
  });

  it("lookup_principles returns principles", () => {
    const result = executeGhostwriterTool(db, 1, "lookup_principles", {});
    // May be empty if no principles seeded — that's fine, just no error
    expect(typeof result).toBe("string");
  });

  it("update_draft returns confirmation", () => {
    const result = executeGhostwriterTool(db, 1, "update_draft", {
      draft: "New draft text here",
      change_summary: "Rewrote the hook",
    });
    expect(result).toContain("Draft updated");
  });

  it("search_past_posts returns results or empty", () => {
    const result = executeGhostwriterTool(db, 1, "search_past_posts", { query: "security" });
    expect(typeof result).toBe("string");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run server/src/__tests__/ghostwriter-tools.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ghostwriter-tools.ts**

Create `server/src/ai/ghostwriter-tools.ts`. This file contains the tool schema definitions and a dispatcher function.

Tool definitions (the `tools` array passed to the Messages API):

```typescript
import type Database from "better-sqlite3";
import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import { getEditorialPrinciples } from "../db/generate-queries.js";
import { getAuthorProfile } from "../db/profile-queries.js";
import fs from "fs";
import path from "path";

export const GHOSTWRITER_TOOLS: Tool[] = [
  {
    name: "get_author_profile",
    description: "Get the author's voice profile — their topics, opinions, mental models, anti-examples, and audience. Call this at conversation start or when you need to check voice alignment.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "lookup_principles",
    description: "Look up editorial principles learned from the author's past revisions. These describe HOW the author likes to write — naming real people, compressing process into lists, closing styles, etc. Filter by post_type for more relevant results.",
    input_schema: {
      type: "object" as const,
      properties: {
        post_type: { type: "string", description: "Optional: personal_story, opinion, industry_news, announcement, etc." },
      },
      required: [],
    },
  },
  {
    name: "search_past_posts",
    description: "Search the author's past LinkedIn posts by topic or pattern. Returns hook text, impressions, engagement rate, and content type. Use this to find what has worked before on similar topics.",
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
    description: "Get specific LinkedIn platform knowledge and best practices. Use this when you identify a weakness in the draft (weak hook, wrong length, poor format choice) and need data-backed guidance.",
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
```

Tool dispatcher:

```typescript
// State holder for the current draft (passed in from the route handler)
let _currentDraft = "";
let _lastChangeSummary = "";

export function setCurrentDraft(draft: string) { _currentDraft = draft; }
export function getCurrentDraft() { return _currentDraft; }
export function getLastChangeSummary() { return _lastChangeSummary; }

export function executeGhostwriterTool(
  db: Database.Database,
  personaId: number,
  toolName: string,
  input: Record<string, any>
): string {
  switch (toolName) {
    case "get_author_profile": {
      const profile = getAuthorProfile(db, personaId);
      return profile?.profile_text ?? "No author profile available. Ask the user about their background and perspective.";
    }
    case "lookup_principles": {
      const principles = getEditorialPrinciples(db, personaId, input.post_type);
      if (principles.length === 0) return "No editorial principles recorded yet.";
      return principles.map((p, i) =>
        `${i + 1}. ${p.principle_text} (confidence: ${p.confidence.toFixed(1)}, seen ${p.frequency}x${p.source_post_type ? `, typical for: ${p.source_post_type}` : ""})`
      ).join("\n");
    }
    case "search_past_posts": {
      const sortBy = input.sort_by ?? "impressions";
      const limit = input.limit ?? 5;
      const allowedSorts = new Set(["impressions", "engagement_rate", "reactions", "comments"]);
      const safeSort = allowedSorts.has(sortBy) ? sortBy : "impressions";

      const rows = db.prepare(`
        SELECT p.hook_text, p.content_type, p.published_at,
               m.impressions, m.reactions, m.comments, m.engagement_rate
        FROM posts p
        LEFT JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest ON latest.post_id = p.id
        LEFT JOIN post_metrics m ON m.id = latest.max_id
        WHERE p.persona_id = ? AND (p.hook_text LIKE ? OR p.full_text LIKE ?)
        ORDER BY m.${safeSort} DESC NULLS LAST
        LIMIT ?
      `).all(personaId, `%${input.query}%`, `%${input.query}%`, limit) as any[];

      if (rows.length === 0) return `No past posts found matching "${input.query}".`;
      return rows.map((r: any) =>
        `- "${(r.hook_text ?? "").slice(0, 100)}" (${r.published_at?.slice(0, 10) ?? "?"}) — ${r.impressions ?? 0} impressions, ${((r.engagement_rate ?? 0) * 100).toFixed(1)}% ER, ${r.reactions ?? 0} reactions, ${r.comments ?? 0} comments`
      ).join("\n");
    }
    case "get_platform_knowledge": {
      return getPlatformKnowledgeSection(input.aspect);
    }
    case "update_draft": {
      _currentDraft = input.draft;
      _lastChangeSummary = input.change_summary;
      return `Draft updated. Change: ${input.change_summary}`;
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}
```

The `getPlatformKnowledgeSection` function parses `linkedin-knowledge.md` and `ai-insights-research.md` by section headers, returning the relevant section for the requested aspect. Map aspects to section headers:

```typescript
const KNOWLEDGE_SECTIONS: Record<string, string[]> = {
  hooks: ["Hook Type Analysis"],
  closings: [], // No dedicated section — return hook + length guidance
  length: ["Optimal Post Length"],
  format: ["Content Format Performance", "Content Format"],
  engagement: ["Engagement Quality Hierarchy", "Engagement Rate Benchmarks"],
  timing: ["The \"Golden Hour\"", "Posting Frequency"],
  comments: ["Comments"],
  dwell_time: ["Dwell Time"],
  topic_authority: ["Topic Authority"],
};

function getPlatformKnowledgeSection(aspect: string): string {
  const headers = KNOWLEDGE_SECTIONS[aspect];
  if (!headers || headers.length === 0) return `No specific knowledge available for "${aspect}".`;

  // Read both knowledge files
  const knowledgePath = path.join(import.meta.dirname, "linkedin-knowledge.md");
  const researchPath = path.join(import.meta.dirname, "../../docs/ai-insights-research.md");

  let content = "";
  for (const filePath of [knowledgePath, researchPath]) {
    try {
      const text = fs.readFileSync(filePath, "utf-8");
      for (const header of headers) {
        const regex = new RegExp(`### ${header}[\\s\\S]*?(?=\\n###|\\n---|\$)`, "i");
        const match = text.match(regex);
        if (match) content += match[0] + "\n\n";
      }
    } catch {}
  }

  return content.trim() || `No knowledge found for "${aspect}".`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run server/src/__tests__/ghostwriter-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/ghostwriter-tools.ts server/src/__tests__/ghostwriter-tools.test.ts
git commit -m "feat: ghostwriter tool definitions and handlers"
```

---

## Chunk 2: Agentic Loop & System Prompt (server core)

### Task 4: Ghostwriter Agentic Loop

**Files:**
- Create: `server/src/ai/ghostwriter.ts`
- Test: `server/src/__tests__/ghostwriter.test.ts`

- [ ] **Step 1: Write the system prompt builder**

Create `server/src/ai/ghostwriter.ts`. The system prompt is behavioral instructions — it tells the AI HOW to conduct the conversation, not WHAT to write. Reference `server/src/ai/interviewer-prompt.ts` for the follow-up strategy patterns.

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import {
  GHOSTWRITER_TOOLS,
  executeGhostwriterTool,
  setCurrentDraft,
  getCurrentDraft,
  getLastChangeSummary,
} from "./ghostwriter-tools.js";
import { insertGenerationMessage } from "../db/generate-queries.js";
import type { Draft } from "@reachlab/shared";

function buildGhostwriterSystemPrompt(
  selectedDrafts: Draft[],
  userFeedback: string,
  storyContext: string
): string {
  const draftsBlock = selectedDrafts.map((d, i) =>
    `--- Draft ${i + 1} (${d.type}) ---\nHook: ${d.hook}\n\nBody:\n${d.body}\n\nClosing: ${d.closing}`
  ).join("\n\n");

  return `You are a LinkedIn post ghostwriter working one-on-one with the author. You have tools to look up their voice profile, editorial principles, past post performance, and LinkedIn platform best practices. Use them selectively — don't front-load everything.

## Your Process

1. IMMEDIATELY produce a combined draft from the selected variations and user feedback below. Call update_draft with your first version.
2. After updating the draft, review it critically. Identify the weakest elements — vague claims, anonymous sources, generic closings, untold specifics.
3. Ask ONE targeted question about the most important gap. Not a generic question — a question driven by what THIS draft specifically needs. For example: if the draft says "a colleague told me," ask who. If it describes a failure, ask what specifically broke.
4. When the user answers, revise the draft incorporating their answer, call update_draft, then identify the next gap.
5. Keep going until the draft is specific, concrete, and sounds like the author — not like AI.

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

- [ ] **Step 2: Write the agentic loop**

Continue in `ghostwriter.ts`:

```typescript
export interface GhostwriterTurnResult {
  assistantMessage: string;       // What the AI said to the user
  draft: string | null;           // Updated draft (if update_draft was called)
  changeSummary: string | null;   // What changed in the draft
  toolsUsed: string[];            // Which tools were called this turn
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
  setCurrentDraft(currentDraft);
  const toolsUsed: string[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  // Build the messages array for the API call
  const apiMessages = [...messages];

  // Agentic loop: keep calling until stop_reason !== "tool_use"
  let response: Anthropic.Message;
  while (true) {
    const start = Date.now();
    response = await client.messages.create({
      model: MODELS.SONNET,
      max_tokens: 4000,
      system: systemPrompt,
      tools: GHOSTWRITER_TOOLS,
      messages: apiMessages,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    // Log this iteration
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

    // If no tool use, we're done
    if (response.stop_reason !== "tool_use") break;

    // Execute tool calls and build tool_result messages
    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolsUsed.push(block.name);
        const result = executeGhostwriterTool(db, personaId, block.name, block.input as Record<string, any>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    // Append the assistant's response and tool results for the next iteration
    apiMessages.push({ role: "assistant", content: response.content as any });
    apiMessages.push({ role: "user", content: toolResults as any });
  }

  // Extract the text response
  const textBlocks = response.content.filter(b => b.type === "text");
  const assistantMessage = textBlocks.map(b => (b as any).text).join("\n");

  // Check if draft was updated during this turn
  const draft = getCurrentDraft();
  const changeSummary = getLastChangeSummary();
  const draftChanged = draft !== currentDraft;

  // Persist messages
  insertGenerationMessage(db, {
    generation_id: generationId,
    role: "assistant",
    content: assistantMessage,
    draft_snapshot: draftChanged ? draft : undefined,
  });

  return {
    assistantMessage,
    draft: draftChanged ? draft : null,
    changeSummary: draftChanged ? changeSummary : null,
    toolsUsed,
    input_tokens: totalInput,
    output_tokens: totalOutput,
  };
}

export { buildGhostwriterSystemPrompt };
```

- [ ] **Step 3: Write tests for the system prompt builder**

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

  it("includes behavioral instructions", () => {
    const prompt = buildGhostwriterSystemPrompt(mockDrafts, "", "");
    expect(prompt).toContain("ONE question at a time");
    expect(prompt).toContain("update_draft");
    expect(prompt).toContain("Follow-Up Strategy");
  });

  it("handles empty feedback gracefully", () => {
    const prompt = buildGhostwriterSystemPrompt(mockDrafts, "", "story");
    expect(prompt).toContain("No specific direction given");
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- --run server/src/__tests__/ghostwriter.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/ghostwriter.ts server/src/__tests__/ghostwriter.test.ts
git commit -m "feat: ghostwriter agentic loop with tool-use and behavioral system prompt"
```

### Task 5: API Endpoint

**Files:**
- Modify: `server/src/routes/generate.ts`
- Modify: `server/src/schemas/generate.ts`
- Test: `server/src/__tests__/generate-routes.test.ts`

- [ ] **Step 1: Add the schema**

Add to `server/src/schemas/generate.ts`:

```typescript
export const ghostwriteBody = z.object({
  generation_id: z.number().int().positive(),
  message: z.string().trim().min(1).max(10000),
});
```

- [ ] **Step 2: Add the route**

Add to `server/src/routes/generate.ts`, after the chat endpoint. Import `ghostwriterTurn` and `buildGhostwriterSystemPrompt` from `../ai/ghostwriter.js`. Import `ghostwriteBody` from schemas.

```typescript
app.post("/api/generate/ghostwrite", async (request, reply) => {
  const personaId = getPersonaId(request);
  const { generation_id, message } = validateBody(ghostwriteBody, request.body);

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

    // Use combining_guidance as initial feedback for first turn, message for subsequent
    const isFirstTurn = history.length <= 1; // Only the user message we just inserted
    const systemPrompt = buildGhostwriterSystemPrompt(
      selectedDrafts.length > 0 ? selectedDrafts : drafts,
      isFirstTurn ? (gen.combining_guidance ?? message) : "",
      storyContext
    );

    const currentDraft = gen.final_draft ?? "";

    const result = await ghostwriterTurn(
      client, db, personaId, generation_id, logger,
      messages, systemPrompt, currentDraft
    );

    // Persist draft update if changed
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

- [ ] **Step 3: Add test for the endpoint**

Add to `server/src/__tests__/generate-routes.test.ts`:

```typescript
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

- [ ] **Step 4: Run tests**

Run: `pnpm test -- --run server/src/__tests__/generate-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/generate.ts server/src/schemas/generate.ts server/src/__tests__/generate-routes.test.ts
git commit -m "feat: POST /api/generate/ghostwrite endpoint with agentic tool-use loop"
```

---

## Chunk 3: Dashboard — API Client & Chat UI

### Task 6: API Client Method

**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add types and API method**

Add to `dashboard/src/api/client.ts`:

```typescript
// Near the other Gen types
export interface GhostwriteResponse {
  message: string;
  draft: string | null;
  change_summary: string | null;
  tools_used: string[];
}
```

Add to the `api` object:

```typescript
ghostwrite: (generationId: number, message: string) =>
  fetch(withPersonaId(`/api/generate/ghostwrite`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generation_id: generationId, message }),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<GhostwriteResponse>;
  }),
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --project dashboard/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add ghostwrite API client method"
```

### Task 7: GhostwriterChat Component

**Files:**
- Create: `dashboard/src/pages/generate/GhostwriterChat.tsx`

This is the split-view component: chat on the left, live draft on the right. The draft highlights recently changed text with a brief fade effect.

- [ ] **Step 1: Create the component**

Create `dashboard/src/pages/generate/GhostwriterChat.tsx`:

```typescript
import { useState, useRef, useEffect } from "react";
import { api, type GhostwriteResponse } from "../../api/client";
import ScannerLoader from "./components/ScannerLoader";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  changeSummary?: string;
}

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
}
```

The component layout:
- Outer: `flex min-h-[70vh]` with two columns
- Left (chat): `w-1/2 border-r border-gen-border-1 flex flex-col` containing scrollable message list + input area at bottom
- Right (draft): `w-1/2 p-6 overflow-y-auto` containing the draft text with `whitespace-pre-line` and a word count footer

Chat messages display:
- User messages: `bg-gen-bg-2 rounded-lg p-3 ml-8` (right-aligned feel)
- Assistant messages: `bg-transparent p-3 mr-8` with subtle `text-gen-text-1`
- If a message has `changeSummary`, show a small pill: `text-[11px] text-gen-accent bg-gen-accent/10 px-2 py-0.5 rounded`

The draft panel:
- Uses `font-serif-gen text-[16px] leading-relaxed text-gen-text-0`
- When the draft updates, apply a brief `animate-fade-up` with 0.3s duration to indicate the change
- Bottom bar: word count (tabular-nums), Copy button, Open in LinkedIn button

Input area at the bottom of the chat panel:
- `textarea` with auto-resize, placeholder: "Tell me what to change, answer my questions, or say 'looks good'..."
- Send button, Enter to send (Shift+Enter for newline)
- While waiting for response, show a subtle typing indicator (three dots pulsing)

On mount (or when `generationId` changes), if there are no chat messages yet, auto-send the initial message. The initial message combines the user's guidance with a "start the ghostwriting session" prompt:
```typescript
// Auto-start the conversation
useEffect(() => {
  if (gen.generationId && gen.chatMessages.length === 0 && !loading) {
    const initialMessage = gen.combiningGuidance?.trim()
      ? gen.combiningGuidance
      : "Combine these drafts into a single strong post.";
    sendMessage(initialMessage);
  }
}, [gen.generationId]);
```

The `sendMessage` function:
```typescript
const sendMessage = async (message: string) => {
  if (!gen.generationId || !message.trim() || loading) return;
  setLoading(true);

  // Optimistic user message
  const userMsg: ChatMessage = { role: "user", content: message.trim() };
  setGen((prev: any) => ({
    ...prev,
    chatMessages: [...prev.chatMessages, userMsg],
  }));

  try {
    const res = await api.ghostwrite(gen.generationId, message.trim());

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: res.message,
      changeSummary: res.change_summary ?? undefined,
    };

    setGen((prev: any) => ({
      ...prev,
      finalDraft: res.draft ?? prev.finalDraft,
      chatMessages: [...prev.chatMessages, assistantMsg],
    }));
    setChatInput("");
  } catch (err: any) {
    // Remove optimistic message on error
    setGen((prev: any) => ({
      ...prev,
      chatMessages: prev.chatMessages.slice(0, -1),
    }));
    console.error("Ghostwrite failed:", err);
  } finally {
    setLoading(false);
  }
};
```

Draft panel footer with Copy and Open in LinkedIn:
```typescript
const handleCopy = async () => {
  await navigator.clipboard.writeText(gen.finalDraft);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
};

const handleOpenLinkedIn = async () => {
  await navigator.clipboard.writeText(gen.finalDraft);
  window.open("https://www.linkedin.com/feed/?shareActive=true", "_blank");
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --project dashboard/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/generate/GhostwriterChat.tsx
git commit -m "feat: GhostwriterChat split-view component — chat left, live draft right"
```

### Task 8: Wire Into Generate Flow

**Files:**
- Modify: `dashboard/src/pages/Generate.tsx`
- Modify: `dashboard/src/pages/generate/DraftVariations.tsx`

- [ ] **Step 1: Update Generate.tsx to use GhostwriterChat as step 3**

Import `GhostwriterChat` and replace the `ReviewEdit` rendering at step 3:

```typescript
import GhostwriterChat from "./generate/GhostwriterChat";
```

In the render, change the step 3 block:

```typescript
{subTab === "Generate" && step === 3 && (
  <GhostwriterChat
    gen={gen}
    setGen={setGen}
    loading={loading}
    setLoading={setLoading}
    onBack={() => setStep(2)}
  />
)}
```

Keep `ReviewEdit` import and the step 4 retro flow — those remain accessible from the chat view (a "Run retro" link in the draft panel footer).

- [ ] **Step 2: Update DraftVariations to transition correctly**

The current `handleCombineAndReview` calls the combine endpoint and moves to step 3. Change it to:
1. Save the selected drafts + guidance to the generation record (already done)
2. Move to step 3 (GhostwriterChat), which auto-starts the conversation

Replace the combine API call with just persisting state and advancing:

```typescript
const handleCombineAndReview = async () => {
  if (gen.generationId === null || selectedCount === 0) return;

  // Save selection to the generation record
  try {
    // The ghostwriter chat will handle combining via the agentic loop
    setGen((prev: any) => ({
      ...prev,
      selectedDraftIndices: prev.selectedDraftIndices,
      combiningGuidance: reviseFeedback || prev.combiningGuidance,
    }));
    onNext();
  } catch (err) {
    console.error("Failed to advance:", err);
  }
};
```

Note: The combine endpoint (`/api/generate/combine`) is no longer called directly — the ghostwriter's first turn handles combining via its `update_draft` tool call.

- [ ] **Step 3: Type-check both projects**

Run: `npx tsc --noEmit --project dashboard/tsconfig.json`
Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 4: Manual smoke test**

1. Start the dev server: `pnpm dev`
2. Navigate to Generate tab
3. Pick a topic, generate drafts
4. Select 1-2 drafts, optionally add guidance
5. Click "Combine & review" — should enter the ghostwriter chat
6. The AI should produce an initial combined draft and ask a targeted question
7. Answer the question — the draft should update
8. Verify the draft panel shows updates with change indicators

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/Generate.tsx dashboard/src/pages/generate/DraftVariations.tsx dashboard/src/pages/generate/GhostwriterChat.tsx
git commit -m "feat: wire ghostwriter chat into generate flow as step 3"
```

---

## Chunk 4: Polish & Retro Integration

### Task 9: Draft Change Highlighting

**Files:**
- Modify: `dashboard/src/pages/generate/GhostwriterChat.tsx`

- [ ] **Step 1: Add change highlighting to the draft panel**

When the draft updates, set a `draftJustChanged` flag that triggers a CSS transition. Use a `key` prop that changes on each draft update to trigger the `animate-fade-up` animation:

```typescript
const [draftVersion, setDraftVersion] = useState(0);

// In the effect that handles draft changes:
useEffect(() => {
  setDraftVersion(v => v + 1);
}, [gen.finalDraft]);
```

In the draft panel:
```tsx
<div key={draftVersion} className="animate-fade-up" style={{ animationDuration: "0.3s" }}>
  <p className="font-serif-gen text-[16px] leading-relaxed text-gen-text-0 whitespace-pre-line">
    {gen.finalDraft}
  </p>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/generate/GhostwriterChat.tsx
git commit -m "feat: draft change highlighting with fade animation"
```

### Task 10: Retro System Integration with Editorial Principles

**Files:**
- Modify: `server/src/ai/retro.ts`

- [ ] **Step 1: After retro analysis, extract and store editorial principles**

In `retro.ts`, after `analyzeRetro` returns the analysis, add a function that converts the retro's `patterns` and `changes` into editorial principles:

```typescript
import { insertEditorialPrinciple, getEditorialPrinciples, confirmPrinciple } from "../db/generate-queries.js";

export function storeRetroAsPrinciples(
  db: Database.Database,
  personaId: number,
  analysis: RetroAnalysis,
  postCategory?: string
): void {
  const existing = getEditorialPrinciples(db, personaId);

  for (const pattern of analysis.patterns) {
    // Check if a similar principle already exists (simple substring match)
    const match = existing.find(p =>
      p.principle_text.toLowerCase().includes(pattern.toLowerCase().slice(0, 30)) ||
      pattern.toLowerCase().includes(p.principle_text.toLowerCase().slice(0, 30))
    );

    if (match) {
      confirmPrinciple(db, match.id);
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

- [ ] **Step 2: Call it from the retro route**

In `server/src/routes/generate.ts`, in the retro endpoint handler, after `analyzeRetro` succeeds, call:

```typescript
const { storeRetroAsPrinciples } = await import("../ai/retro.js");
storeRetroAsPrinciples(db, personaId, result.analysis, gen.post_type);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/retro.ts server/src/routes/generate.ts
git commit -m "feat: retro analysis stores editorial principles for ghostwriter retrieval"
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
5. Copy the draft and verify it's publishable
6. Run a retro on a published post and verify principles are stored
7. Start a new generation and verify the ghostwriter's `lookup_principles` tool returns the stored principles

- [ ] **Step 4: Commit everything**

```bash
git add -A
git commit -m "feat: ghostwriter chat — complete integration"
```
