# Interactive Coach Chat Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive coaching chat that can query analytics data, research external factors, and provide data-backed advice — while extracting a shared agent loop and chat UI from the ghostwriter.

**Architecture:** Extract the ghostwriter's agent loop into a generic `agentTurn` function. Extract shared tools (web_search, fetch_url, get_rules, add_or_update_rule) into a shared module. Build coach-specific tools that wrap existing deep-dive query functions. Create a shared `AgentChat` React component. Add a slide-out coach chat panel on Overview and Coach pages.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, @anthropic-ai/sdk (via OpenRouter), React, Tailwind v4, Vitest

**Spec:** `docs/superpowers/specs/2026-04-02-coach-chat-design.md`

---

## Chunk 1: Extract Shared Agent Loop

### Task 1: Create agent-loop.ts — extract generic agent turn

**Files:**
- Create: `server/src/ai/agent-loop.ts`
- Modify: `server/src/ai/ghostwriter.ts`
- Test: `server/src/__tests__/agent-loop.test.ts`

- [ ] **Step 1: Write tests for expandMessageRow and CLEARED_TOOL_RESULT**

Create `server/src/__tests__/agent-loop.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { expandMessageRow, CLEARED_TOOL_RESULT } from "../ai/agent-loop.js";

describe("expandMessageRow", () => {
  it("returns plain text for legacy messages (null tool_blocks_json)", () => {
    const result = expandMessageRow(
      { role: "assistant", content: "hello", tool_blocks_json: null },
      true
    );
    expect(result).toEqual([{ role: "assistant", content: "hello" }]);
  });

  it("expands tool blocks + final text for assistant messages", () => {
    const toolBlocks = JSON.stringify([
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "web_search", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "results" }] },
    ]);
    const result = expandMessageRow(
      { role: "assistant", content: "Here is what I found", tool_blocks_json: toolBlocks },
      true
    );
    expect(result).toHaveLength(3); // tool_use + tool_result + final text
    expect(result[2]).toEqual({ role: "assistant", content: "Here is what I found" });
  });

  it("clears old tool results when not recent", () => {
    const toolBlocks = JSON.stringify([
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "web_search", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "long results here" }] },
    ]);
    const result = expandMessageRow(
      { role: "assistant", content: "summary", tool_blocks_json: toolBlocks },
      false
    );
    expect(result[1].content[0].content).toBe(CLEARED_TOOL_RESULT);
  });

  it("falls back to plain text on corrupt JSON", () => {
    const result = expandMessageRow(
      { role: "assistant", content: "fallback", tool_blocks_json: "not json{" },
      true
    );
    expect(result).toEqual([{ role: "assistant", content: "fallback" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- server/src/__tests__/agent-loop.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create agent-loop.ts**

Move `CLEARED_TOOL_RESULT`, `StoredToolBlock`, `expandMessageRow` from `ghostwriter.ts` into the new file. Then add the generic `agentTurn` function. **IMPORTANT:** In `ghostwriter.ts`, re-export these so existing imports in `generate.ts` don't break: `export { expandMessageRow, CLEARED_TOOL_RESULT } from "./agent-loop.js";`

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import type { AiLogger } from "./logger.js";

export const CLEARED_TOOL_RESULT = "[Old tool result content cleared]";

export interface StoredToolBlock {
  role: "assistant" | "user";
  content: any;
}

export function expandMessageRow(
  row: { role: string; content: string; tool_blocks_json: string | null },
  isRecent: boolean
): Array<{ role: "user" | "assistant"; content: any }> {
  // (exact same implementation currently in ghostwriter.ts)
}

// ── Generic agent turn ──────────────────────────────────────

export interface AgentTurnConfig {
  client: Anthropic;
  model: string;
  tools: Tool[];
  executeTool: (name: string, input: Record<string, unknown>) => string | Promise<string>;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: any }>;
  logger: AiLogger;
  maxIterations?: number;
  maxInputTokens?: number;
  turnDeadlineMs?: number;
  apiTimeoutMs?: number;
  maxTokens?: number;
}

export interface AgentTurnResult {
  assistantMessage: string;
  toolsUsed: string[];
  toolBlockLog: StoredToolBlock[];
  input_tokens: number;
  output_tokens: number;
}

const DEFAULTS = {
  maxIterations: 10,
  maxInputTokens: 30_000,
  turnDeadlineMs: 60_000,
  apiTimeoutMs: 30_000,
  maxTokens: 4000,
};

export async function agentTurn(config: AgentTurnConfig): Promise<AgentTurnResult> {
  const maxIterations = config.maxIterations ?? DEFAULTS.maxIterations;
  const maxInputTokens = config.maxInputTokens ?? DEFAULTS.maxInputTokens;
  const turnDeadlineMs = config.turnDeadlineMs ?? DEFAULTS.turnDeadlineMs;
  const apiTimeoutMs = config.apiTimeoutMs ?? DEFAULTS.apiTimeoutMs;
  const maxTokens = config.maxTokens ?? DEFAULTS.maxTokens;

  let iterations = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const toolsUsed: string[] = [];
  const toolBlockLog: StoredToolBlock[] = [];
  const apiMessages: Array<{ role: "user" | "assistant"; content: any }> = [...config.messages];
  const turnStart = Date.now();
  let lastResponse: Anthropic.Messages.Message | null = null;

  while (true) {
    if (++iterations > maxIterations) {
      throw new Error("Agent exceeded maximum tool iterations");
    }
    if (totalInput > maxInputTokens) break;

    const elapsed = Date.now() - turnStart;
    if (elapsed > turnDeadlineMs) break;

    const remainingMs = Math.min(apiTimeoutMs, turnDeadlineMs - elapsed);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    const iterStart = Date.now();

    let response: Anthropic.Messages.Message;
    try {
      response = await config.client.messages.create(
        {
          model: config.model,
          max_tokens: maxTokens,
          system: config.systemPrompt,
          tools: config.tools,
          messages: apiMessages,
        },
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeout);
    }

    lastResponse = response;
    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    config.logger.log({
      step: "agent_turn",
      model: config.model,
      input_messages: JSON.stringify(apiMessages.slice(-1)),
      output_text: JSON.stringify(response.content),
      tool_calls: null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: 0,
      duration_ms: Date.now() - iterStart,
    });

    if (response.stop_reason !== "tool_use") break;

    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        if (!block.id || typeof block.name !== "string") continue;
        toolsUsed.push(block.name);
        const result = await config.executeTool(
          block.name,
          block.input as Record<string, unknown>
        );
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }

    apiMessages.push({ role: "assistant", content: response.content });
    apiMessages.push({ role: "user", content: toolResults });
    toolBlockLog.push({ role: "assistant", content: response.content });
    toolBlockLog.push({ role: "user", content: toolResults });
  }

  if (!lastResponse) throw new Error("Agent produced no response");

  const assistantMessage =
    lastResponse.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n") || "(No response)";

  return { assistantMessage, toolsUsed, toolBlockLog, input_tokens: totalInput, output_tokens: totalOutput };
}
```

- [ ] **Step 4: Update ghostwriter.ts to use agentTurn**

Replace the while loop in `ghostwriterTurn` with a call to `agentTurn`. Import from `agent-loop.ts`. Remove the moved code (CLEARED_TOOL_RESULT, StoredToolBlock, expandMessageRow). Keep the ghostwriter-specific wrapping: `GhostwriterState` management, `insertGenerationMessage`, draft change detection.

The key change: `ghostwriterTurn` now wraps `executeTool` to update `GhostwriterState`:

```typescript
import { agentTurn, type StoredToolBlock } from "./agent-loop.js";
// Re-export for consumers
export { expandMessageRow, CLEARED_TOOL_RESULT } from "./agent-loop.js";

// In ghostwriterTurn:
const result = await agentTurn({
  client,
  model: MODELS.SONNET,
  tools: GHOSTWRITER_TOOLS,
  executeTool: (name, input) => executeGhostwriterTool(db, personaId, name, input, state, logger),
  systemPrompt,
  messages,
  logger,
});

// Then use result.assistantMessage, result.toolBlockLog, result.toolsUsed
```

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: All tests pass (existing ghostwriter tests + new agent-loop tests).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`

- [ ] **Step 7: Commit**

```bash
git add server/src/ai/agent-loop.ts server/src/__tests__/agent-loop.test.ts server/src/ai/ghostwriter.ts
git commit -m "refactor: extract generic agent loop from ghostwriter"
```

### Task 2: Extract shared tools into shared-tools.ts

**Files:**
- Create: `server/src/ai/shared-tools.ts`
- Modify: `server/src/ai/ghostwriter-tools.ts`
- Test: `server/src/__tests__/shared-tools.test.ts`

- [ ] **Step 1: Create shared-tools.ts**

Extract from `ghostwriter-tools.ts`: the tool definitions and dispatch cases for `web_search`, `fetch_url`, `get_rules`, `add_or_update_rule`. Also extract the shared imports (`chatWebSearch`, `fetchUrl`, `getRules`, `updateRule`, `insertSingleRule`, `getMaxRuleSortOrder`).

```typescript
import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import type Database from "better-sqlite3";
import type { AiLogger } from "./logger.js";
import { chatWebSearch, fetchUrl } from "./web-tools.js";
import { getRules, updateRule, insertSingleRule, getMaxRuleSortOrder } from "../db/generate-queries.js";

export const SHARED_TOOLS: Tool[] = [
  { name: "web_search", /* ... same definition ... */ },
  { name: "fetch_url", /* ... same definition ... */ },
  { name: "get_rules", /* ... same definition ... */ },
  { name: "add_or_update_rule", /* ... same definition ... */ },
];

export function executeSharedTool(
  db: Database.Database,
  personaId: number,
  toolName: string,
  input: Record<string, unknown>,
  logger: AiLogger
): string | Promise<string> | null {
  // Returns null if toolName is not a shared tool (caller handles domain-specific tools)
  switch (toolName) {
    case "web_search": { /* ... */ }
    case "fetch_url": { /* ... */ }
    case "get_rules": { /* ... */ }
    case "add_or_update_rule": { /* ... */ }
    default: return null;
  }
}
```

- [ ] **Step 2: Update ghostwriter-tools.ts to import from shared**

```typescript
import { SHARED_TOOLS, executeSharedTool } from "./shared-tools.js";

export const GHOSTWRITER_TOOLS: Tool[] = [
  // ghostwriter-specific tools
  { name: "get_author_profile", /* ... */ },
  { name: "lookup_principles", /* ... */ },
  { name: "search_past_posts", /* ... */ },
  { name: "get_platform_knowledge", /* ... */ },
  { name: "update_draft", /* ... */ },
  // shared tools
  ...SHARED_TOOLS,
];

export async function executeGhostwriterTool(/* ... */): Promise<string> {
  // Try shared tools first
  const shared = await executeSharedTool(db, personaId, toolName, input, logger);
  if (shared !== null) return shared;

  // Ghostwriter-specific tools
  switch (toolName) {
    case "get_author_profile": { /* ... */ }
    // ... etc
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: All existing tests pass (this is a pure refactor).

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/shared-tools.ts server/src/ai/ghostwriter-tools.ts
git commit -m "refactor: extract shared tools (web_search, fetch_url, rules) into shared-tools.ts"
```

---

## Chunk 2: Coach Chat Backend

### Task 3: Database — migration and queries

**Files:**
- Create: `server/src/db/migrations/026-coach-chat.sql`
- Create: `server/src/db/coach-chat-queries.ts`
- Test: `server/src/__tests__/coach-chat-queries.test.ts`

- [ ] **Step 1: Write the migration**

Check latest migration number at execution time (currently 025).

```sql
-- 026-coach-chat.sql
CREATE TABLE coach_chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  title TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coach_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES coach_chat_sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_blocks_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 2: Write tests**

Create `server/src/__tests__/coach-chat-queries.test.ts` using the existing test DB pattern:

```typescript
import { describe, it, expect } from "vitest";
import {
  createCoachSession,
  getCoachSession,
  listCoachSessions,
  insertCoachMessage,
  getCoachMessages,
} from "../db/coach-chat-queries.js";

describe("coach chat sessions", () => {
  it("creates and retrieves a session", () => { /* ... */ });
  it("lists sessions ordered by most recent", () => { /* ... */ });
});

describe("coach chat messages", () => {
  it("inserts and retrieves messages with tool_blocks_json", () => { /* ... */ });
  it("returns null tool_blocks_json for messages without tools", () => { /* ... */ });
  it("limits message retrieval", () => { /* ... */ });
});
```

- [ ] **Step 3: Implement coach-chat-queries.ts**

```typescript
import type Database from "better-sqlite3";

export interface CoachSession {
  id: number;
  persona_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoachMessage {
  id: number;
  session_id: number;
  role: string;
  content: string;
  tool_blocks_json: string | null;
  created_at: string;
}

export function createCoachSession(db: Database.Database, personaId: number, title?: string): number {
  const result = db.prepare(
    "INSERT INTO coach_chat_sessions (persona_id, title) VALUES (?, ?)"
  ).run(personaId, title ?? null);
  return Number(result.lastInsertRowid);
}

export function getCoachSession(db: Database.Database, sessionId: number): CoachSession | undefined {
  return db.prepare("SELECT * FROM coach_chat_sessions WHERE id = ?").get(sessionId) as CoachSession | undefined;
}

export function listCoachSessions(db: Database.Database, personaId: number, limit: number = 20): CoachSession[] {
  return db.prepare(
    "SELECT * FROM coach_chat_sessions WHERE persona_id = ? ORDER BY updated_at DESC LIMIT ?"
  ).all(personaId, limit) as CoachSession[];
}

export function insertCoachMessage(
  db: Database.Database,
  data: { session_id: number; role: string; content: string; tool_blocks_json?: string }
): number {
  const result = db.prepare(
    "INSERT INTO coach_chat_messages (session_id, role, content, tool_blocks_json) VALUES (?, ?, ?, ?)"
  ).run(data.session_id, data.role, data.content, data.tool_blocks_json ?? null);
  // Update session timestamp
  db.prepare("UPDATE coach_chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(data.session_id);
  return Number(result.lastInsertRowid);
}

export function getCoachMessages(db: Database.Database, sessionId: number, limit: number = 20): CoachMessage[] {
  return db.prepare(
    "SELECT * FROM coach_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
  ).all(sessionId, limit) as CoachMessage[];
}
```

- [ ] **Step 4: Run tests, type-check, commit**

Run: `pnpm test && npx tsc --noEmit --project server/tsconfig.json`

```bash
git add server/src/db/migrations/026-coach-chat.sql server/src/db/coach-chat-queries.ts server/src/__tests__/coach-chat-queries.test.ts
git commit -m "feat: add coach chat session/message tables and queries"
```

### Task 4: Coach chat tools

**Files:**
- Create: `server/src/ai/coach-chat-tools.ts`
- Test: `server/src/__tests__/coach-chat-tools.test.ts`

- [ ] **Step 1: Write tests for coach-specific tools**

Test the pure query tools that return formatted strings. Use a test DB with sample posts and metrics.

- [ ] **Step 2: Implement coach-chat-tools.ts**

The coach tools MUST call existing query functions from `server/src/db/ai/deep-dive.ts` and `server/src/db/stats-queries.ts` — do NOT write new SQL. This ensures the coach chat produces the same numbers as the dashboard (especially the weighted ER formula from `computeWeightedER()`). The tools format the results as human-readable strings for the LLM.

```typescript
import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import type Database from "better-sqlite3";
import type { AiLogger } from "./logger.js";
import { SHARED_TOOLS, executeSharedTool } from "./shared-tools.js";
import { getCategoryPerformance, getEngagementQuality, getTopicPerformance, getProgressMetrics, getHookPerformance } from "../db/ai/deep-dive.js";
import { queryTiming } from "../db/queries.js";

const COACH_SPECIFIC_TOOLS: Tool[] = [
  {
    name: "query_posts",
    description: "Search and filter the user's LinkedIn posts by date range, topic, category, or keyword. Returns post text with performance metrics.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search keyword or phrase (optional)" },
        days_back: { type: "number", description: "Only posts from the last N days (default: all)" },
        sort_by: { type: "string", enum: ["impressions", "engagement_rate", "reactions", "comments", "published_at"], description: "Sort by metric (default: published_at)" },
        limit: { type: "number", description: "Max results (1-20, default 10)" },
      },
      required: [],
    },
  },
  {
    name: "get_performance_summary",
    description: "Get overall posting performance summary for a time period. Includes total posts, average impressions, average engagement rate, and comparison vs the prior period.",
    input_schema: {
      type: "object" as const,
      properties: {
        days_back: { type: "number", description: "Time period in days (default: 30)" },
      },
      required: [],
    },
  },
  {
    name: "get_category_breakdown",
    description: "Get performance breakdown by content category. Shows which categories are reliable, declining, or underexplored.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_topic_performance",
    description: "Get topic-level performance rankings. Shows which specific topics drive the most engagement.",
    input_schema: {
      type: "object" as const,
      properties: {
        days_back: { type: "number", description: "Time period in days (optional)" },
      },
      required: [],
    },
  },
  {
    name: "get_timing_analysis",
    description: "Get best posting days and hours based on historical engagement data.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_engagement_quality",
    description: "Get engagement quality breakdown — reactions vs comments vs saves ratio, and how engagement quality has changed over time.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_hook_analysis",
    description: "Get performance by hook type (question, statistic, story, etc.) and format style (list, narrative, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        days_back: { type: "number", description: "Time period in days (optional)" },
      },
      required: [],
    },
  },
];

export const COACH_CHAT_TOOLS: Tool[] = [...COACH_SPECIFIC_TOOLS, ...SHARED_TOOLS];

export async function executeCoachTool(
  db: Database.Database,
  personaId: number,
  toolName: string,
  input: Record<string, unknown>,
  logger: AiLogger
): Promise<string> {
  // Try shared tools first
  const shared = await executeSharedTool(db, personaId, toolName, input, logger);
  if (shared !== null) return shared;

  try {
    switch (toolName) {
      case "query_posts": { /* query posts table with filters, format results */ }
      case "get_performance_summary": {
        const days = typeof input.days_back === "number" ? input.days_back : 30;
        const metrics = getProgressMetrics(db, personaId, days);
        // Format current vs previous period comparison
        return `Performance (last ${days} days vs prior ${days} days):\n...`;
      }
      case "get_category_breakdown": {
        const categories = getCategoryPerformance(db, personaId);
        if (categories.length === 0) return "No category data available yet.";
        return categories.map(c => `- ${c.category}: ${c.post_count} posts, ${c.median_er?.toFixed(1)}% median ER [${c.status}]`).join("\n");
      }
      case "get_topic_performance": {
        const days = typeof input.days_back === "number" ? input.days_back : undefined;
        const topics = getTopicPerformance(db, personaId, days);
        if (topics.length === 0) return "No topic data available yet.";
        // Note: TopicPerformance uses `median_wer` not `median_er`
        return topics.map(t => `- "${t.topic}": ${t.post_count} posts, ${t.median_wer.toFixed(1)}% weighted ER, ${t.median_impressions} median impressions`).join("\n");
      }
      case "get_timing_analysis": {
        // Use queryTiming from db/queries.ts (NOT getTimingSlots)
        const timing = queryTiming(db, personaId);
        if (!timing || timing.length === 0) return "No timing data available yet.";
        // Format by day and hour
        return formatTimingData(timing);
      }
      case "get_engagement_quality": {
        const eq = getEngagementQuality(db, personaId);
        if (!eq) return "No engagement data available yet.";
        // Actual fields: comment_ratio, save_rate, repost_rate, weighted_er, standard_er, total_posts
        return `Engagement quality (${eq.total_posts} posts):\n- Weighted ER: ${eq.weighted_er?.toFixed(2)}%\n- Standard ER: ${eq.standard_er?.toFixed(2)}%\n- Comment ratio: ${eq.comment_ratio?.toFixed(3)}\n- Save rate: ${eq.save_rate?.toFixed(3)}\n- Repost rate: ${eq.repost_rate?.toFixed(3)}`;
      }
      case "get_hook_analysis": {
        const days = typeof input.days_back === "number" ? input.days_back : undefined;
        const hooks = getHookPerformance(db, personaId, days);
        // HookPerformance uses `name` not `label`, and `median_wer` not `median_er`
        return `By hook type:\n${hooks.by_hook_type.map(h => `- ${h.name}: ${h.post_count} posts, ${h.median_wer.toFixed(1)}% ER`).join("\n")}\n\nBy format:\n${hooks.by_format_style.map(h => `- ${h.name}: ${h.post_count} posts, ${h.median_wer.toFixed(1)}% ER`).join("\n")}`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err: unknown) {
    return `Tool error (${toolName}): ${err instanceof Error ? err.message : String(err)}`;
  }
}
```

Note: The implementer should read the actual return types from `deep-dive.ts` and `stats-queries.ts` to get the exact field names right. The code above shows the pattern; exact field access needs to match the real types.

- [ ] **Step 3: Run tests, type-check, commit**

```bash
git add server/src/ai/coach-chat-tools.ts server/src/__tests__/coach-chat-tools.test.ts
git commit -m "feat: add coach chat tools wrapping analytics queries"
```

### Task 5: Coach chat agent and system prompt

**Files:**
- Create: `server/src/ai/coach-chat.ts`

- [ ] **Step 1: Implement coach-chat.ts**

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { agentTurn } from "./agent-loop.js";
import { COACH_CHAT_TOOLS, executeCoachTool } from "./coach-chat-tools.js";
import { insertCoachMessage } from "../db/coach-chat-queries.js";
import type { AiLogger } from "./logger.js";

const COACH_SYSTEM_PROMPT = `You are a LinkedIn performance coach. You have access to the user's complete post analytics — performance metrics, content categories, timing data, engagement quality, and writing rules. Use your tools to pull data before giving advice.

## Behavior

- Always cite specific numbers when making claims ("your ER dropped from 4.2% to 2.1% over the last 2 weeks").
- Pull data BEFORE giving advice. Don't speculate when you can query.
- Be direct — if something isn't working, say so clearly.
- ONE question at a time if you need clarification.
- Keep responses focused. This is a coaching conversation, not a lecture.

## Web Research

When the user asks about external factors (algorithm changes, platform trends, competitor activity):
- Use web_search to find current information.
- Use fetch_url for specific articles.
- Mention sources in chat.

## Learning from Corrections

When the user corrects you ("don't do that", "never use X", etc.):
1. Identify whether the underlying PRINCIPLE is clear or ambiguous.
2. If clear → call get_rules to check for existing similar rules, then add_or_update_rule to save the principle. Confirm what you saved.
3. If ambiguous → ask ONE clarifying question to find the right abstraction level.
4. Always save at the PRINCIPLE level, not the specific instance.
5. If a similar rule already exists, broaden or refine it rather than creating a duplicate.`;

export interface CoachChatTurnResult {
  assistantMessage: string;
  toolsUsed: string[];
  input_tokens: number;
  output_tokens: number;
}

export async function coachChatTurn(
  client: Anthropic,
  db: Database.Database,
  personaId: number,
  sessionId: number,
  logger: AiLogger,
  messages: Array<{ role: "user" | "assistant"; content: any }>,
): Promise<CoachChatTurnResult> {
  const result = await agentTurn({
    client,
    model: MODELS.SONNET,
    tools: COACH_CHAT_TOOLS,
    executeTool: (name, input) => executeCoachTool(db, personaId, name, input, logger),
    systemPrompt: COACH_SYSTEM_PROMPT,
    messages,
    logger,
  });

  // Persist assistant message
  insertCoachMessage(db, {
    session_id: sessionId,
    role: "assistant",
    content: result.assistantMessage,
    tool_blocks_json: result.toolBlockLog.length > 0 ? JSON.stringify(result.toolBlockLog) : undefined,
  });

  return {
    assistantMessage: result.assistantMessage,
    toolsUsed: result.toolsUsed,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
  };
}
```

- [ ] **Step 2: Type-check, commit**

```bash
git add server/src/ai/coach-chat.ts
git commit -m "feat: add coach chat agent with system prompt"
```

### Task 6: Coach chat routes

**Files:**
- Create: `server/src/routes/coach-chat.ts`
- Modify: `server/src/app.ts`
- Create: `server/src/schemas/coach-chat.ts`

- [ ] **Step 1: Create Zod schemas**

```typescript
// server/src/schemas/coach-chat.ts
import { z } from "zod";

export const coachChatBody = z.object({
  session_id: z.number().int().positive().nullable(),
  message: z.string().min(1).max(5000),
});

export const createSessionBody = z.object({
  title: z.string().max(200).optional(),
});
```

Wait — the server doesn't use Zod everywhere. Check `server/src/validation.ts` and `server/src/schemas/generate.ts` for the actual validation pattern. The generate schemas use a custom `validateBody` with plain objects or Zod — follow whichever pattern exists.

- [ ] **Step 2: Implement routes**

```typescript
// server/src/routes/coach-chat.ts
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { createClient } from "../ai/client.js";
import { AiLogger } from "../ai/logger.js";
import { createRun, completeRun, failRun, getRunCost } from "../db/ai-queries.js";
import { createCoachSession, getCoachSession, listCoachSessions, insertCoachMessage, getCoachMessages } from "../db/coach-chat-queries.js";
import { coachChatTurn } from "../ai/coach-chat.js";
import { expandMessageRow } from "../ai/agent-loop.js";
import { getPersonaId } from "../utils.js";
import { validateBody } from "../validation.js";
import { coachChatBody, createSessionBody } from "../schemas/coach-chat.js";

export function registerCoachChatRoutes(app: FastifyInstance, db: Database.Database): void {
  const activeRequests = new Set<number>();

  app.post("/api/coach/chat", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { session_id, message } = validateBody(coachChatBody, request.body);

    // Create session on first message if null
    let sessionId = session_id;
    if (!sessionId) {
      sessionId = createCoachSession(db, personaId, message.slice(0, 100));
    }

    const session = getCoachSession(db, sessionId);
    if (!session || session.persona_id !== personaId) {
      return reply.status(404).send({ error: "Session not found" });
    }

    if (activeRequests.has(sessionId)) {
      return reply.status(429).send({ error: "Request already in progress" });
    }
    activeRequests.add(sessionId);

    const client = createClient(process.env.TRUSTMIND_LLM_API_KEY!);
    const runId = createRun(db, personaId, "coach_chat", 0);
    const logger = new AiLogger(db, runId);

    try {
      // Build messages with microcompaction
      const history = getCoachMessages(db, sessionId, 20).reverse();
      const recentThreshold = Math.max(0, history.length - 10);
      const messages: Array<{ role: "user" | "assistant"; content: any }> = [];
      for (let i = 0; i < history.length; i++) {
        const isRecent = i >= recentThreshold;
        messages.push(...expandMessageRow(history[i], isRecent));
      }
      messages.push({ role: "user", content: message });

      // Persist user message BEFORE the turn so IDs are in order
      // (coachChatTurn persists the assistant message internally)
      insertCoachMessage(db, { session_id: sessionId, role: "user", content: message });

      const result = await coachChatTurn(client, db, personaId, sessionId, logger, messages);

      completeRun(db, runId, getRunCost(db, runId));

      return {
        session_id: sessionId,
        message: result.assistantMessage,
        tools_used: result.toolsUsed,
      };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    } finally {
      activeRequests.delete(sessionId);
    }
  });

  app.get("/api/coach/chat/sessions", async (request) => {
    const personaId = getPersonaId(request);
    return { sessions: listCoachSessions(db, personaId) };
  });

  app.post("/api/coach/chat/sessions", async (request) => {
    const personaId = getPersonaId(request);
    const { title } = validateBody(createSessionBody, request.body);
    const id = createCoachSession(db, personaId, title);
    return { session_id: id };
  });

  app.get("/api/coach/chat/sessions/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sessionId = parseInt(id, 10);
    if (isNaN(sessionId)) return reply.status(400).send({ error: "Invalid id" });

    const personaId = getPersonaId(request);
    const session = getCoachSession(db, sessionId);
    if (!session || session.persona_id !== personaId) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const messages = getCoachMessages(db, sessionId, 20).reverse();
    return messages;
  });
}
```

- [ ] **Step 3: Register routes in app.ts**

Add import and call `registerCoachChatRoutes(app, db)` alongside the other route registrations.

- [ ] **Step 4: Run tests, type-check, commit**

```bash
git add server/src/routes/coach-chat.ts server/src/schemas/coach-chat.ts server/src/app.ts
git commit -m "feat: add coach chat routes"
```

---

## Chunk 3: Frontend

### Task 7: Extract shared AgentChat component

**Files:**
- Create: `dashboard/src/components/AgentChat.tsx`
- Modify: `dashboard/src/pages/generate/GhostwriterChat.tsx`

- [ ] **Step 1: Create AgentChat.tsx**

Extract the chat message rendering, input, typing indicator, tool badges, and auto-scroll from `GhostwriterChat.tsx` into a reusable component:

```typescript
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tools_used?: string[];
}

interface AgentChatProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  loading: boolean;
  placeholder?: string;
  className?: string;
  userBubbleClass?: string;
  assistantBubbleClass?: string;
  inputClass?: string;
  disabled?: boolean;
}
```

Contains: message list with auto-scroll, typing indicator, tool badges, chat input with Enter-to-send, error display.

- [ ] **Step 2: Refactor GhostwriterChat to use AgentChat**

Replace the chat panel JSX with `<AgentChat>`. Keep the split-view layout, draft panel, copy/LinkedIn buttons, and auto-save logic in GhostwriterChat.

- [ ] **Step 3: Type-check, visually verify**

Run: `npx tsc --noEmit --project dashboard/tsconfig.json`
Start dev server and verify ghostwriter chat still works.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/AgentChat.tsx dashboard/src/pages/generate/GhostwriterChat.tsx
git commit -m "refactor: extract shared AgentChat component from GhostwriterChat"
```

### Task 8: Coach chat panel and API client

**Files:**
- Create: `dashboard/src/components/CoachChatPanel.tsx`
- Modify: `dashboard/src/api/client.ts`
- Modify: `dashboard/src/pages/Coach.tsx`
- Modify: `dashboard/src/pages/Overview.tsx`

- [ ] **Step 1: Add coach chat API methods to client.ts**

```typescript
// Coach Chat
coachChat: (sessionId: number | null, message: string) =>
  postScoped<{ session_id: number; message: string; tools_used: string[] }>(
    "/coach/chat", { session_id: sessionId, message }
  ),

coachChatSessions: () =>
  getScoped<{ sessions: Array<{ id: number; title: string | null; created_at: string }> }>(
    "/coach/chat/sessions"
  ),

coachChatMessages: (sessionId: number) =>
  getScoped<Array<{ id: number; role: string; content: string; created_at: string }>>(
    `/coach/chat/sessions/${sessionId}/messages`
  ),
```

- [ ] **Step 2: Create CoachChatPanel.tsx**

Slide-out panel (~400px wide, right side) containing:
- Header with session selector dropdown + "New chat" button + close button
- `<AgentChat>` component with main-app palette styling (surface-*/text-*/accent, NOT gen-* palette)
- Session management state

```typescript
interface CoachChatPanelProps {
  open: boolean;
  onClose: () => void;
}
```

Uses `useState` for session management (currentSessionId, sessions list, messages, loading). Fetches sessions on mount, loads messages when session changes.

- [ ] **Step 3: Add trigger button to Coach.tsx and Overview.tsx**

Add a "Chat with Coach" button to both pages that toggles a `CoachChatPanel` open/closed:

```tsx
const [coachChatOpen, setCoachChatOpen] = useState(false);

// In the page header area:
<button onClick={() => setCoachChatOpen(true)} className="...">Chat with Coach</button>

// At the end of the component:
<CoachChatPanel open={coachChatOpen} onClose={() => setCoachChatOpen(false)} />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit --project dashboard/tsconfig.json`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/CoachChatPanel.tsx dashboard/src/api/client.ts dashboard/src/pages/Coach.tsx dashboard/src/pages/Overview.tsx
git commit -m "feat: add coach chat panel with slide-out UI on Coach and Overview pages"
```

---

## Chunk 4: Integration Testing

### Task 9: End-to-end manual test

- [ ] **Step 1: Start dev server**: `pnpm dev`
- [ ] **Step 2: Verify migration 026 runs** (check server logs)
- [ ] **Step 3: Open Overview page**, click "Chat with Coach", verify panel opens
- [ ] **Step 4: Ask a performance question** ("How have my posts been doing?") — verify it queries data and cites numbers
- [ ] **Step 5: Ask about a specific topic** ("Which topics get the most engagement?") — verify it uses get_topic_performance
- [ ] **Step 6: Ask about external factors** ("Has LinkedIn changed their algorithm?") — verify web_search is called
- [ ] **Step 7: Test session persistence** — close panel, reopen, verify conversation is preserved
- [ ] **Step 8: Test on Coach page** — verify same trigger button and panel work
- [ ] **Step 9: Verify ghostwriter still works** — go to Generate, run through ghostwriter chat
- [ ] **Step 10: Run all tests**: `pnpm test`
- [ ] **Step 11: Final type-check**: `npx tsc --noEmit --project server/tsconfig.json && npx tsc --noEmit --project dashboard/tsconfig.json`
