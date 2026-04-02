# Ghostwriter Agent Enhancement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ghostwriter chat persistent, web-aware, and self-improving — it remembers tool context across turns, can search the web, and learns from user corrections by adding/updating writing rules.

**Architecture:** Extend the existing ghostwriter tool loop (Sonnet + tool_use iterations). Add three new tools (web_search, fetch_url, add_or_update_rule), persist tool call/result blocks in the DB, and apply microcompaction before each API call. Frontend changes are minimal — tool usage badges on messages and auto/manual origin badges on rules.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, @anthropic-ai/sdk (via OpenRouter), @mozilla/readability, jsdom, Vitest

**Spec:** `docs/superpowers/specs/2026-04-02-ghostwriter-agent-enhancement-design.md`

---

## Chunk 1: Database & Types

### Task 1: Migration — add columns

**Files:**
- Create: `server/src/db/migrations/025-ghostwriter-enhancement.sql`

- [ ] **Step 1: Write the migration**

Check `server/src/db/migrations/` for the latest number at execution time. Currently the latest is `024-editorial-principles.sql`, so use `025`. If another migration has landed, increment accordingly.

```sql
-- 025-ghostwriter-enhancement.sql
ALTER TABLE generation_messages ADD COLUMN tool_blocks_json TEXT;
ALTER TABLE generation_rules ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
```

- [ ] **Step 2: Verify migration applies**

Run: `pnpm dev` (starts server, runs migrations automatically)
Expected: Server starts without errors, logs show migration 025 applied.

- [ ] **Step 3: Verify columns exist**

Run: `sqlite3 data/linkedin.db ".schema generation_messages" | grep tool_blocks`
Expected: `tool_blocks_json TEXT` appears in schema.

Run: `sqlite3 data/linkedin.db ".schema generation_rules" | grep origin`
Expected: `origin TEXT NOT NULL DEFAULT 'manual'` appears.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/migrations/025-ghostwriter-enhancement.sql
git commit -m "feat: add tool_blocks_json and origin columns for ghostwriter enhancement"
```

### Task 2: Update TypeScript types and DB queries

**Files:**
- Modify: `server/src/db/generate-queries.ts:8-15` (GenerationRule type)
- Modify: `server/src/db/generate-queries.ts:548-556` (GenerationMessage type)
- Modify: `server/src/db/generate-queries.ts:558-575` (insertGenerationMessage)
- Modify: `server/src/db/generate-queries.ts:598-608` (insertSingleRule)
- Modify: `server/src/db/generate-queries.ts:120-135` (replaceAllRules)
- Modify: `dashboard/src/api/client.ts:338-343` (GenRule type)

- [ ] **Step 1: Write tests for new DB functions**

Add to existing test file at `server/src/__tests__/generate-queries.test.ts` (use the existing `initDatabase` pattern with a temp DB path). Add these test blocks:

```typescript
// Add these imports to the existing test file if not already present:
import {
  insertGenerationMessage,
  getGenerationMessages,
  insertSingleRule,
  getRules,
  updateRule,
} from "../db/generate-queries.js";
// Use the existing initDatabase / test DB pattern already in the file

describe("generation_messages tool_blocks_json", () => {
  it("inserts and retrieves tool_blocks_json", () => {
    const db = createTestDb();
    const toolBlocks = JSON.stringify([{ type: "tool_use", name: "web_search" }]);
    const id = insertGenerationMessage(db, {
      generation_id: 1,
      role: "assistant",
      content: "test",
      tool_blocks_json: toolBlocks,
    });
    const msgs = getGenerationMessages(db, 1, 10);
    const msg = msgs.find((m) => m.id === id);
    expect(msg?.tool_blocks_json).toBe(toolBlocks);
  });

  it("returns null tool_blocks_json for legacy messages", () => {
    const db = createTestDb();
    insertGenerationMessage(db, {
      generation_id: 1,
      role: "assistant",
      content: "test",
    });
    const msgs = getGenerationMessages(db, 1, 10);
    expect(msgs[0]?.tool_blocks_json).toBeNull();
  });
});

describe("generation_rules origin", () => {
  it("insertSingleRule defaults to manual origin", () => {
    const db = createTestDb();
    insertSingleRule(db, 1, "voice_tone", "test rule", 0);
    const rules = getRules(db, 1);
    expect(rules[0]?.origin).toBe("manual");
  });

  it("insertSingleRule accepts auto origin", () => {
    const db = createTestDb();
    insertSingleRule(db, 1, "voice_tone", "auto rule", 0, "auto");
    const rules = getRules(db, 1);
    expect(rules[0]?.origin).toBe("auto");
  });

  it("updateRule changes rule_text and example_text", () => {
    const db = createTestDb();
    insertSingleRule(db, 1, "voice_tone", "old text", 0);
    const rules = getRules(db, 1);
    updateRule(db, rules[0].id, { rule_text: "new text", example_text: "example" });
    const updated = getRules(db, 1);
    expect(updated[0].rule_text).toBe("new text");
    expect(updated[0].example_text).toBe("example");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- server/src/__tests__/generate-queries.test.ts`
Expected: FAIL — `updateRule` doesn't exist, `insertSingleRule` doesn't accept origin, `insertGenerationMessage` doesn't accept tool_blocks_json.

- [ ] **Step 3: Update GenerationMessage type**

In `server/src/db/generate-queries.ts`, update the interface:

```typescript
export interface GenerationMessage {
  id: number;
  generation_id: number;
  role: string;
  content: string;
  draft_snapshot: string | null;
  quality_json: string | null;
  tool_blocks_json: string | null;
  created_at: string;
}
```

- [ ] **Step 4: Update insertGenerationMessage to accept tool_blocks_json**

```typescript
export function insertGenerationMessage(
  db: Database.Database,
  data: {
    generation_id: number;
    role: string;
    content: string;
    draft_snapshot?: string;
    quality_json?: string;
    tool_blocks_json?: string;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO generation_messages (generation_id, role, content, draft_snapshot, quality_json, tool_blocks_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.generation_id,
      data.role,
      data.content,
      data.draft_snapshot ?? null,
      data.quality_json ?? null,
      data.tool_blocks_json ?? null
    );
  return Number(result.lastInsertRowid);
}
```

- [ ] **Step 5: Update GenerationRule type**

```typescript
export interface GenerationRule {
  id: number;
  category: string;
  rule_text: string;
  example_text: string | null;
  sort_order: number;
  enabled: number;
  origin: string;
}
```

- [ ] **Step 6: Update insertSingleRule to accept origin**

```typescript
export function insertSingleRule(
  db: Database.Database,
  personaId: number,
  category: string,
  ruleText: string,
  sortOrder: number,
  origin: string = "manual"
): void {
  db.prepare(
    "INSERT INTO generation_rules (category, rule_text, sort_order, enabled, persona_id, origin) VALUES (?, ?, ?, 1, ?, ?)"
  ).run(category, ruleText, sortOrder, personaId, origin);
}
```

- [ ] **Step 7: Update replaceAllRules to preserve auto-generated rules**

The PUT `/api/generate/rules` route calls `replaceAllRules()` which deletes all rules and re-inserts. This would destroy auto-generated rules. Fix: only delete MANUAL rules, leave auto rules untouched.

```typescript
export function replaceAllRules(
  db: Database.Database,
  personaId: number,
  rules: Array<{ category: string; rule_text: string; example_text?: string; sort_order: number; enabled?: number }>
): void {
  const tx = db.transaction(() => {
    // Only delete manual rules — auto rules are managed by the ghostwriter agent
    db.prepare("DELETE FROM generation_rules WHERE persona_id = ? AND origin = 'manual'").run(personaId);
    const insert = db.prepare(
      "INSERT INTO generation_rules (persona_id, category, rule_text, example_text, sort_order, enabled, origin) VALUES (?, ?, ?, ?, ?, ?, 'manual')"
    );
    for (const rule of rules) {
      insert.run(personaId, rule.category, rule.rule_text, rule.example_text ?? null, rule.sort_order, rule.enabled ?? 1);
    }
  });
  tx();
}
```

- [ ] **Step 8: Add updateRule function**

Add after `insertSingleRule`:

```typescript
export function updateRule(
  db: Database.Database,
  ruleId: number,
  fields: { rule_text?: string; example_text?: string }
): void {
  if (fields.rule_text !== undefined) {
    db.prepare("UPDATE generation_rules SET rule_text = ? WHERE id = ?").run(fields.rule_text, ruleId);
  }
  if (fields.example_text !== undefined) {
    db.prepare("UPDATE generation_rules SET example_text = ? WHERE id = ?").run(fields.example_text, ruleId);
  }
}
```

- [ ] **Step 9: Update GenRule in dashboard client**

In `dashboard/src/api/client.ts`:

```typescript
export interface GenRule {
  id?: number;
  rule_text: string;
  example_text?: string | null;
  sort_order: number;
  origin?: string;
}
```

- [ ] **Step 10: Run tests**

Run: `pnpm test -- server/src/__tests__/generate-queries.test.ts`
Expected: All tests pass.

- [ ] **Step 11: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json && npx tsc --noEmit --project dashboard/tsconfig.json`
Expected: No errors.

- [ ] **Step 12: Commit**

```bash
git add server/src/db/generate-queries.ts server/src/__tests__/generate-queries.test.ts dashboard/src/api/client.ts
git commit -m "feat: add tool_blocks_json, origin column support, and updateRule function"
```

---

## Chunk 2: New Tools & Dispatcher

### Task 3: Install dependencies

**Files:**
- Modify: `package.json` (root or server)

- [ ] **Step 1: Install @mozilla/readability and jsdom**

Run: `pnpm --filter linkedin-analytics-server add @mozilla/readability jsdom`
Run: `pnpm --filter linkedin-analytics-server add -D @types/jsdom`

Check `server/package.json` for the correct filter name first — use whatever the `"name"` field says.

- [ ] **Step 2: Verify install**

Run: `node -e "require('@mozilla/readability'); require('jsdom'); console.log('ok')"`
Expected: Prints "ok".

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml server/package.json
git commit -m "chore: add @mozilla/readability and jsdom for URL fetching"
```

### Task 4: Update perplexity.ts to accept custom prompts

**Files:**
- Modify: `server/src/ai/perplexity.ts:23-32`

This MUST happen before the web-tools module, which calls `searchWithSonarPro` with 3 arguments.

- [ ] **Step 1: Add optional customPrompt parameter to searchWithSonarPro**

```typescript
export async function searchWithSonarPro(
  topic: string,
  logger: AiLogger,
  customPrompt?: string
): Promise<SonarResult> {
  const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
  if (!apiKey) {
    throw new Error("TRUSTMIND_LLM_API_KEY is required for web research");
  }

  const searchPrompt = customPrompt ?? buildSearchPrompt(topic);
```

The rest of the function stays the same — it already uses `searchPrompt` for the API call and logging.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors. Existing callers pass (topic, logger) which still works with the new optional third param.

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/perplexity.ts
git commit -m "feat: allow custom prompt in searchWithSonarPro for chat context"
```

### Task 5: Add web_search and fetch_url tool implementations

**Files:**
- Create: `server/src/ai/web-tools.ts`
- Test: `server/src/__tests__/web-tools.test.ts`

- [ ] **Step 1: Write tests for web tools**

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildChatSearchPrompt, extractArticle, isPrivateUrl } from "../ai/web-tools.js";

describe("buildChatSearchPrompt", () => {
  it("returns the query directly without research framing", () => {
    const prompt = buildChatSearchPrompt("OpenAI funding round 2026");
    expect(prompt).toContain("OpenAI funding round 2026");
    expect(prompt).not.toContain("practitioner discussions");
  });
});

describe("isPrivateUrl", () => {
  it("blocks localhost", () => {
    expect(isPrivateUrl("http://localhost:3000/api")).toBe(true);
  });
  it("blocks 127.x", () => {
    expect(isPrivateUrl("http://127.0.0.1/secret")).toBe(true);
  });
  it("blocks 10.x", () => {
    expect(isPrivateUrl("http://10.0.0.1/admin")).toBe(true);
  });
  it("blocks 192.168.x", () => {
    expect(isPrivateUrl("http://192.168.1.1/config")).toBe(true);
  });
  it("allows public URLs", () => {
    expect(isPrivateUrl("https://example.com/article")).toBe(false);
  });
});

describe("extractArticle", () => {
  it("extracts text from simple HTML", () => {
    const html = `<html><head><title>Test</title></head><body>
      <article><p>Hello world. This is article content that is long enough to extract.</p></article>
      <nav>Navigation stuff</nav>
    </body></html>`;
    const result = extractArticle(html, "https://example.com");
    expect(result.text).toContain("Hello world");
    expect(result.title).toBe("Test");
  });

  it("falls back to tag stripping for non-article pages", () => {
    const html = "<div><span>Just some text</span></div>";
    const result = extractArticle(html, "https://example.com");
    expect(result.text).toContain("Just some text");
  });

  it("truncates to 8000 chars", () => {
    const html = `<article><p>${"a".repeat(10000)}</p></article>`;
    const result = extractArticle(html, "https://example.com");
    expect(result.text.length).toBeLessThanOrEqual(8000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- server/src/__tests__/web-tools.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement web-tools.ts**

```typescript
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { searchWithSonarPro, type SonarResult } from "./perplexity.js";
import type { AiLogger } from "./logger.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1_000_000; // 1MB
const MAX_TEXT_CHARS = 8_000;

export function buildChatSearchPrompt(query: string): string {
  return `Find current, factual information about: ${query}\n\nInclude specific details, dates, names, and sources. Focus on recent developments.`;
}

export function isPrivateUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === "localhost" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname.startsWith("0.")
    );
  } catch {
    return true; // reject unparseable URLs
  }
}

export interface ArticleResult {
  title: string;
  text: string;
}

export function extractArticle(html: string, url: string): ArticleResult {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article && article.textContent.trim().length > 50) {
    const text = article.textContent.trim().slice(0, MAX_TEXT_CHARS);
    return { title: article.title || "", text };
  }

  // Fallback: strip tags
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
  return { title: "", text };
}

export async function chatWebSearch(
  query: string,
  logger: AiLogger
): Promise<string> {
  const result = await searchWithSonarPro(query, logger, buildChatSearchPrompt(query));
  const citations = result.citations.length > 0
    ? `\n\nSources:\n${result.citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")}`
    : "";
  return `${result.content}${citations}`;
}

export async function fetchUrl(url: string): Promise<string> {
  if (isPrivateUrl(url)) {
    return "Error: Cannot fetch private/internal URLs.";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ReachLab/1.0 (content research)" },
    });

    if (!response.ok) {
      return `Error: HTTP ${response.status} fetching ${url}`;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return `Error: Unsupported content type: ${contentType}`;
    }

    // Read with size limit
    const reader = response.body?.getReader();
    if (!reader) return "Error: No response body";

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) break;
      chunks.push(value);
    }

    const byteLength = Math.min(totalBytes, MAX_BODY_BYTES);
    const allBytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      allBytes.set(chunk, offset);
      offset += chunk.byteLength;
      if (offset >= byteLength) break;
    }
    const text = new TextDecoder().decode(allBytes);

    if (contentType.includes("text/plain")) {
      return text.slice(0, MAX_TEXT_CHARS);
    }

    const article = extractArticle(text, url);
    return article.title
      ? `**${article.title}**\n\n${article.text}`
      : article.text;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return `Error: Timeout fetching ${url} (${FETCH_TIMEOUT_MS / 1000}s limit)`;
    }
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timeout);
  }
}
```

Note: The `searchWithSonarPro` function needs a small modification to accept an optional custom prompt. See Task 5.

- [ ] **Step 4: Run tests**

Run: `pnpm test -- server/src/__tests__/web-tools.test.ts`
Expected: `buildChatSearchPrompt`, `isPrivateUrl`, and `extractArticle` tests pass. `chatWebSearch` tests (if any) may need mocking.

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/web-tools.ts server/src/__tests__/web-tools.test.ts
git commit -m "feat: add web search and URL fetch tools for ghostwriter"
```

### Task 6: Update ghostwriter-tools.ts — new tools and dispatcher

**Files:**
- Modify: `server/src/ai/ghostwriter-tools.ts`
- Test: `server/src/__tests__/ghostwriter-tools.test.ts` (add to existing file)

- [ ] **Step 1: Write tests for new tool dispatch**

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { executeGhostwriterTool, createGhostwriterState } from "../ai/ghostwriter-tools.js";

// Helper to create a test DB with schema + migrations applied
// (reuse the same helper from Task 2 tests)

describe("add_or_update_rule tool", () => {
  it("adds a new rule with auto origin", () => {
    const db = createTestDb();
    const state = createGhostwriterState("draft");
    const result = executeGhostwriterTool(db, 1, "add_or_update_rule", {
      category: "voice_tone",
      rule_text: "Avoid dead metaphors common in tech writing",
    }, state, null as any); // logger not needed for rule tools
    expect(result).toContain("Rule added");
    // Verify in DB
    const rules = db.prepare("SELECT * FROM generation_rules WHERE origin = 'auto'").all();
    expect(rules).toHaveLength(1);
  });

  it("updates an existing rule by id", () => {
    const db = createTestDb();
    // Insert a rule first
    db.prepare("INSERT INTO generation_rules (persona_id, category, rule_text, sort_order, enabled, origin) VALUES (1, 'voice_tone', 'old text', 0, 1, 'auto')").run();
    const rule = db.prepare("SELECT id FROM generation_rules WHERE rule_text = 'old text'").get() as any;

    const state = createGhostwriterState("draft");
    const result = executeGhostwriterTool(db, 1, "add_or_update_rule", {
      rule_id: rule.id,
      category: "voice_tone",
      rule_text: "new text",
    }, state, null as any);
    expect(result).toContain("Rule updated");
  });
});

describe("get_rules tool", () => {
  it("returns rules with id and origin", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO generation_rules (persona_id, category, rule_text, sort_order, enabled, origin) VALUES (1, 'voice_tone', 'Be concise', 0, 1, 'manual')").run();
    const state = createGhostwriterState("draft");
    const result = executeGhostwriterTool(db, 1, "get_rules", {}, state, null as any);
    expect(result).toContain("Be concise");
    expect(result).toContain("manual");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- server/src/__tests__/ghostwriter-tools.test.ts`
Expected: FAIL — new tools not implemented.

- [ ] **Step 3: Update GHOSTWRITER_TOOLS array**

Add new tool definitions to the array in `ghostwriter-tools.ts`. Add these after the existing `update_draft` tool:

```typescript
{
  name: "web_search",
  description:
    "Search the web for current information on a topic. Returns content with source citations. Use to research news, verify claims, or find context for the post topic. You can search multiple times to build understanding.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
},
{
  name: "fetch_url",
  description:
    "Fetch and read a specific web page. Returns extracted article text, not raw HTML. Use when you need the full content of a specific URL from search results.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: { type: "string", description: "The URL to fetch and read" },
    },
    required: ["url"],
  },
},
{
  name: "add_or_update_rule",
  description:
    "Add a new writing rule or update an existing one. Use when the user expresses a correction or preference that should persist across future posts. IMPORTANT: Before adding, check existing rules with get_rules to avoid duplicates. If a similar rule exists, update it instead. Always formulate rules at the PRINCIPLE level, not specific instances.",
  input_schema: {
    type: "object" as const,
    properties: {
      rule_id: { type: "number", description: "ID of existing rule to update (omit to create new)" },
      category: {
        type: "string",
        enum: ["voice_tone", "structure_formatting", "anti_ai_tropes"],
        description: "Rule category",
      },
      rule_text: { type: "string", description: "The rule, stated as a principle" },
      example_text: { type: "string", description: "Optional example illustrating the rule" },
    },
    required: ["category", "rule_text"],
  },
},
```

- [ ] **Step 4: Rename lookup_rules to get_rules and update response format**

Change the tool definition name from `"lookup_rules"` to `"get_rules"`. Update the description:

```typescript
{
  name: "get_rules",
  description:
    "Retrieve the user's writing rules — voice/tone, structure, and anti-AI-tropes guardrails. Returns rule ID, text, category, and origin (manual or auto) so you can update existing rules.",
  input_schema: { type: "object" as const, properties: {}, required: [] },
},
```

- [ ] **Step 5: Update dispatcher signature to include logger**

```typescript
import { chatWebSearch, fetchUrl } from "./web-tools.js";
import { updateRule, insertSingleRule, getMaxRuleSortOrder } from "../db/generate-queries.js";
import type { AiLogger } from "./logger.js";

export function executeGhostwriterTool(
  db: Database.Database,
  personaId: number,
  toolName: string,
  input: Record<string, unknown>,
  state: GhostwriterState,
  logger: AiLogger
): string | Promise<string> {
```

Note: Return type is now `string | Promise<string>` because web_search and fetch_url are async. The caller in `ghostwriter.ts` will need to `await` the result. **IMPORTANT:** Also update existing tests in `server/src/__tests__/ghostwriter-tools.test.ts` to `await` the result of `executeGhostwriterTool` calls, since even synchronous tools now return through a function typed as `string | Promise<string>`.

- [ ] **Step 6: Add new cases to the switch statement**

In the switch inside `executeGhostwriterTool`, rename `case "lookup_rules"` to `case "get_rules"` and update the return format to include ID and origin:

```typescript
case "get_rules": {
  const rules = getRules(db, personaId).filter((r) => r.enabled);
  if (rules.length === 0) return "No writing rules configured.";
  return rules
    .map((r) => `- [id:${r.id}] [${r.category}] [${r.origin}] ${r.rule_text}${r.example_text ? ` (e.g. ${r.example_text})` : ""}`)
    .join("\n");
}
```

Add the new cases:

```typescript
case "web_search": {
  const query = typeof input.query === "string" ? input.query : "";
  if (!query.trim()) return "Error: query is required.";
  return chatWebSearch(query, logger);
}

case "fetch_url": {
  const url = typeof input.url === "string" ? input.url : "";
  if (!url.trim()) return "Error: url is required.";
  return fetchUrl(url);
}

case "add_or_update_rule": {
  const ruleText = typeof input.rule_text === "string" ? input.rule_text : "";
  if (!ruleText.trim()) return "Error: rule_text is required.";
  const category = typeof input.category === "string" ? input.category : "voice_tone";
  const exampleText = typeof input.example_text === "string" ? input.example_text : undefined;

  if (typeof input.rule_id === "number") {
    // Update existing rule
    updateRule(db, input.rule_id, { rule_text: ruleText, example_text: exampleText });
    return `Rule updated (id:${input.rule_id}): ${ruleText}`;
  }

  // Add new rule
  const sortOrder = getMaxRuleSortOrder(db, category, personaId) + 1;
  insertSingleRule(db, personaId, category, ruleText, sortOrder, "auto");
  return `Rule added [${category}]: ${ruleText}`;
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test -- server/src/__tests__/ghostwriter-tools.test.ts`
Expected: All tests pass.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add server/src/ai/ghostwriter-tools.ts server/src/ai/ghostwriter-tools.test.ts
git commit -m "feat: add web_search, fetch_url, add_or_update_rule tools to ghostwriter"
```

---

## Chunk 3: Persistent Context & Microcompaction

### Task 7: Update ghostwriter.ts — persist tool blocks and replay with compaction

**Files:**
- Modify: `server/src/ai/ghostwriter.ts`

This is the core change. The ghostwriter loop needs to:
1. Collect all intermediate tool_use/tool_result pairs during the loop
2. Persist them as `tool_blocks_json` on the assistant message
3. On subsequent turns, replay them from DB with microcompaction

- [ ] **Step 1: Add the CLEARED_TOOL_RESULT constant and replay helper**

At the top of `ghostwriter.ts`, after the existing imports:

```typescript
export const CLEARED_TOOL_RESULT = "[Old tool result content cleared]";

interface StoredToolBlock {
  role: "assistant" | "user";
  content: any; // Anthropic content blocks
}

/**
 * Expand a generation_messages row into API messages.
 * If tool_blocks_json is present, it expands into the intermediate
 * assistant(tool_use) + user(tool_result) pairs, followed by the final text.
 * Applies microcompaction: turns older than `recentTurnCount` get tool results cleared.
 */
export function expandMessageRow(
  row: { role: string; content: string; tool_blocks_json: string | null },
  isRecent: boolean
): Array<{ role: "user" | "assistant"; content: any }> {
  if (!row.tool_blocks_json) {
    // Legacy message — plain text only
    return [{ role: row.role as "user" | "assistant", content: row.content }];
  }

  const toolBlocks: StoredToolBlock[] = JSON.parse(row.tool_blocks_json);
  const messages: Array<{ role: "user" | "assistant"; content: any }> = [];

  for (const block of toolBlocks) {
    if (!isRecent && block.role === "user" && Array.isArray(block.content)) {
      // Microcompact: clear tool result content but keep structure
      const compacted = block.content.map((b: any) =>
        b.type === "tool_result"
          ? { ...b, content: CLEARED_TOOL_RESULT }
          : b
      );
      messages.push({ role: "user", content: compacted });
    } else {
      messages.push({ role: block.role, content: block.content });
    }
  }

  // The final text message
  if (row.role === "assistant") {
    messages.push({ role: "assistant", content: row.content });
  }

  return messages;
}
```

- [ ] **Step 2: Update ghostwriterTurn to collect and persist tool blocks**

In the `ghostwriterTurn` function, add a `toolBlockLog` array to collect intermediate messages:

```typescript
const toolBlockLog: StoredToolBlock[] = [];
```

Inside the while loop, after tool execution (where `apiMessages.push` happens), also push to `toolBlockLog`:

```typescript
// Existing lines that push to apiMessages:
apiMessages.push({ role: "assistant", content: response.content });
apiMessages.push({ role: "user", content: toolResults });

// NEW: also collect for persistence
toolBlockLog.push({ role: "assistant", content: response.content });
toolBlockLog.push({ role: "user", content: toolResults });
```

- [ ] **Step 3: Update the await for async tool results**

Since `executeGhostwriterTool` now returns `string | Promise<string>`, the tool execution loop needs to await:

```typescript
for (const block of response.content) {
  if (block.type === "tool_use") {
    if (!block.id || typeof block.name !== "string") continue;
    toolsUsed.push(block.name);
    const result = await executeGhostwriterTool(
      db,
      personaId,
      block.name,
      block.input as Record<string, unknown>,
      state,
      logger
    );
    toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
  }
}
```

- [ ] **Step 4: Persist tool_blocks_json on the assistant message**

Update the `insertGenerationMessage` call at the end of the function:

```typescript
insertGenerationMessage(db, {
  generation_id: generationId,
  role: "assistant",
  content: assistantMessage,
  draft_snapshot: draftChanged ? state.currentDraft : undefined,
  tool_blocks_json: toolBlockLog.length > 0 ? JSON.stringify(toolBlockLog) : undefined,
});
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/ghostwriter.ts
git commit -m "feat: persist tool blocks and add microcompaction replay in ghostwriter"
```

### Task 8: Update generate.ts route to replay with expanded messages

**Files:**
- Modify: `server/src/routes/generate.ts:484-489`

- [ ] **Step 1: Update the ghostwrite route message building**

In the `/api/generate/ghostwrite` route handler, replace the message-building section:

```typescript
// Load history — consistent limit (20, matching restore)
const history = getGenerationMessages(db, generation_id, 20).reverse();

// Replay with microcompaction — last 5 turns get full tool context
const recentThreshold = Math.max(0, history.length - 10); // 5 user+assistant pairs = 10 rows
const messages: Array<{ role: "user" | "assistant"; content: any }> = [];
for (let i = 0; i < history.length; i++) {
  const isRecent = i >= recentThreshold;
  const expanded = expandMessageRow(history[i], isRecent);
  messages.push(...expanded);
}
```

Add the import at the top of generate.ts:

```typescript
import { ghostwriterTurn, buildFirstTurnPrompt, buildSubsequentTurnPrompt, expandMessageRow } from "../ai/ghostwriter.js";
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/generate.ts
git commit -m "feat: replay ghostwriter messages with expanded tool context"
```

---

## Chunk 4: System Prompt — Principle Extraction

### Task 9: Update ghostwriter system prompts

**Files:**
- Modify: `server/src/ai/ghostwriter.ts` (BEHAVIORAL_INSTRUCTIONS constant)

- [ ] **Step 1: Add principle-extraction instructions to BEHAVIORAL_INSTRUCTIONS**

Append to the `BEHAVIORAL_INSTRUCTIONS` constant:

```typescript
const BEHAVIORAL_INSTRUCTIONS = `## Behavior

- Your FIRST action: call update_draft with a combined/improved draft. No preamble.
- ONE question at a time. Never compound questions.
- Don't ask things you can look up. Use tools first (author profile, rules, principles, past posts).
- If the user edits the draft directly, adapt. Don't revert their changes.
- When the user says "looks good", "done", "publish", "ship it", or similar — stop asking questions. Respond with a brief confirmation.
- Keep your responses SHORT. This is about refining the draft, not lecturing.

## Web Research

When the post involves news, current events, or claims you need to verify:
- Use web_search to find current information. You can search multiple times to build understanding.
- Use fetch_url to read specific articles in full when search summaries aren't enough.
- Mention your sources in the chat message (e.g. "According to [source]...") but do NOT put citations in the draft unless the user asks.
- Say "Let me look that up..." before searching so the user knows what's happening.

## Learning from Corrections

When the user corrects you ("don't do that", "never use X", "that sounds like AI", etc.):
1. First, identify whether the underlying PRINCIPLE is clear or ambiguous.
2. If clear (e.g. "never use emoji") → call get_rules to check for existing similar rules, then call add_or_update_rule to save the principle. Confirm what you saved.
3. If ambiguous (e.g. "that sounds weird") → ask ONE clarifying question to find the right abstraction level. Example: "Is it specifically that you don't want the word 'landscape,' or more broadly that I should avoid overused tech/business metaphors?"
4. Always save at the PRINCIPLE level, not the specific instance. Not "don't say landscape" but "avoid dead metaphors common in tech/business writing."
5. If a similar rule already exists, broaden or refine it (update) rather than creating a duplicate.

## Follow-Up Strategies

When the user gives a surface-level answer:
SURFACE (generic, clich\u00e9, abstract) → "Can you make that more concrete? Give me a specific example."
ENERGY (they get more specific) → "Say more about that."
CASUAL ASIDE ("oh, and also...") → "Wait — say that again. What's behind that?"
CONTRADICTION with something earlier → "Interesting — earlier you said X, but now Y. How do those fit together?"
EXHAUSTED thread (clear, complete answer) → Brief acknowledge, move on.

## Draft Updates

When you update the draft, always use the update_draft tool with the FULL draft text (not a diff).
After updating, explain what you changed in 1-2 sentences, then ask ONE focused question to guide the next refinement.`;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/ghostwriter.ts
git commit -m "feat: add web research and principle-extraction prompting to ghostwriter"
```

---

## Chunk 5: Frontend Changes

### Task 10: Show tool usage on assistant messages

**Files:**
- Modify: `dashboard/src/pages/generate/GhostwriterChat.tsx`

- [ ] **Step 1: Update the API response type to include tools_used**

The `/api/generate/ghostwrite` endpoint already returns `tools_used` in its response. Update the `api.ghostwrite` response handling to pass `tools_used` through to the chat messages.

In `GhostwriterChat.tsx`, update the `ChatMessage` interface:

```typescript
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tools_used?: string[];
}
```

Update the `sendMessage` function where it adds the assistant message:

```typescript
setGen((prev: any) => ({
  ...prev,
  originalDraft: prev.originalDraft != null && prev.originalDraft !== ""
    ? prev.originalDraft
    : (res.draft ?? prev.originalDraft),
  finalDraft: res.draft ?? prev.finalDraft,
  chatMessages: [...prev.chatMessages, {
    role: "assistant",
    content: res.message,
    tools_used: res.tools_used,
  }],
}));
```

- [ ] **Step 2: Add tool usage badges below assistant messages**

In the chat message rendering, add a tools badge below assistant messages:

```tsx
{msg.role === "assistant" && msg.tools_used && msg.tools_used.length > 0 && (
  <div className="mt-1 flex flex-wrap gap-1">
    {msg.tools_used.includes("web_search") && (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gen-bg-3 text-gen-text-3 border border-gen-border-1">
        Searched the web
      </span>
    )}
    {msg.tools_used.includes("fetch_url") && (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gen-bg-3 text-gen-text-3 border border-gen-border-1">
        Read article
      </span>
    )}
    {msg.tools_used.includes("add_or_update_rule") && (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gen-bg-3 text-gen-text-3 border border-gen-border-1">
        Updated rules
      </span>
    )}
  </div>
)}
```

- [ ] **Step 3: Update the api client ghostwrite response type**

In `dashboard/src/api/client.ts`, find the `ghostwrite` function and ensure `tools_used` is in the response type.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit --project dashboard/tsconfig.json`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/generate/GhostwriterChat.tsx dashboard/src/api/client.ts
git commit -m "feat: show tool usage badges on ghostwriter chat messages"
```

### Task 11: Add auto badge to rules settings page

**Files:**
- Modify: `dashboard/src/pages/generate/components/RuleItem.tsx`
- Modify: `dashboard/src/pages/generate/Rules.tsx`
- Modify: `server/src/routes/generate.ts` (Rules GET endpoint)

- [ ] **Step 1: Update the Rules GET endpoint to include origin**

In `server/src/routes/generate.ts`, in the `/api/generate/rules` GET handler, update the item construction:

```typescript
const item = {
  id: rule.id,
  rule_text: rule.rule_text,
  example_text: rule.example_text,
  sort_order: rule.sort_order,
  origin: rule.origin,
};
```

- [ ] **Step 2: Update RuleItem to show auto badge**

Read `dashboard/src/pages/generate/components/RuleItem.tsx` to understand the current structure, then add an "auto" badge when `origin === "auto"`:

```tsx
{rule.origin === "auto" && (
  <span className="text-[9px] px-1 py-0.5 rounded bg-gen-accent/10 text-gen-accent border border-gen-accent/20 uppercase tracking-wider">
    auto
  </span>
)}
```

- [ ] **Step 3: Type-check both projects**

Run: `npx tsc --noEmit --project server/tsconfig.json && npx tsc --noEmit --project dashboard/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/generate/components/RuleItem.tsx dashboard/src/pages/generate/Rules.tsx server/src/routes/generate.ts
git commit -m "feat: show auto badge on auto-generated rules in settings"
```

---

## Chunk 6: Integration Testing

### Task 12: End-to-end manual test

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Expected: Server starts on 3211, dashboard on 3210, migration 025 runs.

- [ ] **Step 2: Test ghostwriter chat with web search**

Open the dashboard, create a generation about a current news topic. In the ghostwriter chat, reference something that requires web search (e.g. "I want to write about the latest OpenAI announcement").

Expected: The agent calls web_search, response includes source citations in chat, draft is updated without citations.

- [ ] **Step 3: Test principle extraction**

In the ghostwriter chat, say something like "that sounds too AI-ish, never do that."

Expected: Agent asks a clarifying question about the principle OR saves a principle-level rule and confirms.

- [ ] **Step 4: Verify persistent context**

Continue the conversation for 3+ turns. Check that the agent references things it learned in earlier turns (tool calls from prior turns should be in context).

- [ ] **Step 5: Check rules settings**

Go to the Rules settings page. Verify any auto-generated rules show with the "auto" badge.

- [ ] **Step 6: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 7: Final type-check**

Run: `npx tsc --noEmit --project server/tsconfig.json && npx tsc --noEmit --project dashboard/tsconfig.json`
Expected: No errors.
