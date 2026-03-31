# Ghostwriter Chat Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static combine+review steps with a tool-using conversational agent that interviews the user and iteratively refines a LinkedIn post draft in a split-view chat interface.

**Architecture:** Tool-using agent on the raw Anthropic Messages API (via OpenRouter). The ghostwriter has 6 tools to selectively retrieve context (editorial principles, writing rules, past posts, platform knowledge, author profile) and update the draft. A `while (stop_reason === "tool_use")` loop with a 10-iteration cap, per-call 2-minute timeouts, and an 80K token budget executes tools server-side. Per-request state objects (not module globals) ensure concurrency safety. An in-memory lock prevents concurrent requests to the same generation. Persona ownership is verified on every request.

**Tech Stack:** Fastify, Anthropic SDK (`@anthropic-ai/sdk`) via OpenRouter, SQLite (better-sqlite3), React, Tailwind CSS v4

**Important: Verify early that tool_use works through OpenRouter.** This codebase has zero existing tool_use calls. Before building the full loop, test with a single tool call in isolation.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/src/ai/ghostwriter.ts` | Agentic loop, system prompt builder, per-request state |
| `server/src/ai/ghostwriter-tools.ts` | Tool definitions, handler implementations, input validation |
| `server/src/ai/platform-knowledge.ts` | Pre-extracted LinkedIn knowledge map (no regex, no runtime file reads) |
| `server/src/db/migrations/024-editorial-principles.sql` | Context-indexed editorial principles table |
| `dashboard/src/pages/generate/GhostwriterChat.tsx` | Split-view chat UI (chat left, editable draft right) |
| `server/src/__tests__/ghostwriter-tools.test.ts` | Tool handler tests |
| `server/src/__tests__/ghostwriter.test.ts` | System prompt and loop tests |

### Modified Files
| File | Changes |
|------|---------|
| `server/src/routes/generate.ts` | Add `POST /api/generate/ghostwrite`, `PATCH .../selection`, `PATCH .../draft`; persona checks on existing endpoints |
| `server/src/schemas/generate.ts` | Add `ghostwriteBody`, `selectionBody` schemas |
| `server/src/db/generate-queries.ts` | Editorial principle CRUD + auto-pruning |
| `server/src/ai/retro.ts` | Store retro patterns as principles via LLM dedup |
| `dashboard/src/api/client.ts` | Add `ghostwrite()`, `saveSelection()`, `saveDraft()` |
| `dashboard/src/pages/Generate.tsx` | Wire step 3 to GhostwriterChat, pass onRetro, clear state on back-nav |
| `dashboard/src/pages/generate/DraftVariations.tsx` | Persist selection to DB, set sentinel draft, init reviseFeedback from gen state |

---

## Chunk 1: Database & Tool Handlers

### Task 1: Editorial Principles Migration

**Files:** Create `server/src/db/migrations/024-editorial-principles.sql`

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

- [ ] **Step 2: Verify migration runs** — `pnpm dev`, check no errors
- [ ] **Step 3: Commit** — `git commit -m "feat: add editorial_principles table"`

### Task 2: Editorial Principle Queries

**Files:** Modify `server/src/db/generate-queries.ts`, test `server/src/__tests__/generate-queries.test.ts`

- [ ] **Step 1: Write failing tests** — insert, retrieve, filter by post_type, confirm, cap confidence at 1.0, prune stale

- [ ] **Step 2: Implement**

```typescript
export interface EditorialPrinciple {
  id: number; persona_id: number; principle_text: string;
  source_post_type: string | null; source_context: string | null;
  frequency: number; confidence: number;
  last_confirmed_at: string | null; created_at: string; updated_at: string;
}

export function insertEditorialPrinciple(db, personaId, data: {
  principle_text: string; source_post_type?: string; source_context?: string;
}): number { /* INSERT INTO editorial_principles ... */ }

export function getEditorialPrinciples(db, personaId, postType?: string): EditorialPrinciple[] {
  // Filter by (source_post_type = ? OR source_post_type IS NULL) when postType provided
  // ORDER BY confidence DESC, frequency DESC LIMIT 10
}

export function confirmPrinciple(db, id): void {
  // frequency + 1, confidence = MIN(1.0, confidence + 0.1), updated_at = CURRENT_TIMESTAMP
}

export function pruneStaleEditorialPrinciples(db, personaId): number {
  // DELETE WHERE frequency <= 1 AND created_at < datetime('now', '-30 days')
}
```

- [ ] **Step 3: Run tests** — `pnpm test -- --run server/src/__tests__/generate-queries.test.ts`
- [ ] **Step 4: Commit**

### Task 3: Platform Knowledge Map

**Files:** Create `server/src/ai/platform-knowledge.ts`

Pre-extracted from `linkedin-knowledge.md` and `ai-insights-research.md`. No regex. No runtime file reads. Each aspect maps to a plain string.

- [ ] **Step 1: Create the map**

```typescript
export const PLATFORM_KNOWLEDGE: Record<string, string> = {
  hooks: `## Hook Type Analysis\n...`,      // from ai-insights-research.md
  closings: `## Closing Strategies\n...`,    // synthesized from research
  length: `## Optimal Post Length\n...`,
  format: `## Content Format Performance\n...`,
  engagement: `## Engagement Quality Hierarchy\n...\n## Engagement Rate Benchmarks\n...`,
  timing: `## The "Golden Hour"\n...\n## Posting Frequency\n...`,
  comments: `## Comments\n...`,             // from linkedin-knowledge.md
  dwell_time: `## Dwell Time\n...`,
  topic_authority: `## Topic Authority\n...`,
};
```

Each value is the full section text — copied from the source markdown, not read at runtime.

- [ ] **Step 2: Commit**

### Task 4: Tool Handlers

**Files:** Create `server/src/ai/ghostwriter-tools.ts`, test `server/src/__tests__/ghostwriter-tools.test.ts`

- [ ] **Step 1: Write failing tests**

Test: tool definitions valid, each tool returns a string, per-request state isolation (two states don't interfere), unknown tool returns error string without throwing, tool execution errors caught and returned as strings, `update_draft` rejects empty/short input, `get_platform_knowledge` returns content for every aspect, `search_past_posts` with seeded data returns formatted results.

- [ ] **Step 2: Implement**

Key design: **per-request state object** (not module globals), **try-catch on every handler**, **6 tools** (get_author_profile, lookup_principles, lookup_rules, search_past_posts, get_platform_knowledge, update_draft), **prepared statement map for sort columns**, **LIKE wildcards escaped**.

```typescript
// ── Per-request state ──
export interface GhostwriterState {
  currentDraft: string;
  lastChangeSummary: string;
}
export function createGhostwriterState(initialDraft: string): GhostwriterState {
  return { currentDraft: initialDraft, lastChangeSummary: "" };
}

// ── Tool definitions ──
export const GHOSTWRITER_TOOLS: Tool[] = [
  { name: "get_author_profile", description: "...", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "lookup_principles", description: "...", input_schema: { type: "object", properties: { post_type: { type: "string" } }, required: [] } },
  { name: "lookup_rules", description: "...", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "search_past_posts", description: "...", input_schema: { type: "object", properties: { query: { type: "string" }, sort_by: { type: "string", enum: [...] }, limit: { type: "number" } }, required: ["query"] } },
  { name: "get_platform_knowledge", description: "...", input_schema: { type: "object", properties: { aspect: { type: "string", enum: ["hooks","closings","length","format","engagement","timing","comments","dwell_time","topic_authority"] } }, required: ["aspect"] } },
  { name: "update_draft", description: "...", input_schema: { type: "object", properties: { draft: { type: "string" }, change_summary: { type: "string" } }, required: ["draft", "change_summary"] } },
];

// ── Sort column map (no string interpolation in SQL) ──
const SORT_CLAUSES: Record<string, string> = {
  impressions: "ORDER BY m.impressions DESC NULLS LAST",
  engagement_rate: "ORDER BY m.engagement_rate DESC NULLS LAST",
  reactions: "ORDER BY m.reactions DESC NULLS LAST",
  comments: "ORDER BY m.comments DESC NULLS LAST",
};

// ── Dispatcher ──
export function executeGhostwriterTool(db, personaId, toolName, input, state: GhostwriterState): string {
  try {
    switch (toolName) {
      case "get_author_profile":
        return getAuthorProfile(db, personaId)?.profile_text ?? "No profile. Ask the user.";

      case "lookup_principles":
        // Returns formatted list or "No principles yet" message
        break;

      case "lookup_rules":
        return getRules(db, personaId).filter(r => r.enabled)
          .map(r => `- [${r.category}] ${r.rule_text}`).join("\n") || "No rules configured.";

      case "search_past_posts": {
        // Escape LIKE wildcards in query
        const escaped = input.query.replace(/%/g, "\\%").replace(/_/g, "\\_");
        // Use SORT_CLAUSES map, LIKE ? ESCAPE '\\', limit capped at 10
        break;
      }

      case "get_platform_knowledge":
        return PLATFORM_KNOWLEDGE[input.aspect] ?? `No knowledge for "${input.aspect}".`;

      case "update_draft": {
        // VALIDATE: reject empty or very short drafts
        if (!input.draft || typeof input.draft !== "string" || input.draft.trim().length < 10) {
          return "Error: draft must be at least 10 characters. Provide the full draft text.";
        }
        state.currentDraft = input.draft;
        state.lastChangeSummary = input.change_summary ?? "";
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

- [ ] **Step 3: Run tests, type-check**
- [ ] **Step 4: Commit**

---

## Chunk 2: Agentic Loop & API Endpoints

### Task 5: Ghostwriter Agentic Loop

**Files:** Create `server/src/ai/ghostwriter.ts`, test `server/src/__tests__/ghostwriter.test.ts`

- [ ] **Step 1: System prompt builder**

Two versions: **first-turn prompt** (includes selected draft variations, feedback, story context) and **subsequent-turn prompt** (omits draft variations — they're stale after turn 1, saves tokens).

Behavioral instructions include:
- "Your FIRST action: call update_draft. No preamble."
- ONE question at a time
- Follow-up strategies (SURFACE, ENERGY, CASUAL ASIDE, CONTRADICTION)
- "If the user edits the draft directly, adapt. Don't revert."
- "When the user says 'looks good' / 'done' / 'publish' — stop asking questions."
- Don't ask things you can look up. Use tools first.

- [ ] **Step 2: Agentic loop with all safety guards**

```typescript
const MAX_TOOL_ITERATIONS = 10;
const API_TIMEOUT_MS = 30_000;          // 30s per API call (Sonnet responds in <10s normally)
const TURN_DEADLINE_MS = 60_000;        // 60s total turn deadline
const MAX_TURN_INPUT_TOKENS = 30_000;   // ~$0.10 worst case per turn

export async function ghostwriterTurn(
  client, db, personaId, generationId, logger,
  messages, systemPrompt, currentDraft
): Promise<GhostwriterTurnResult> {

  const state = createGhostwriterState(currentDraft);
  let iterations = 0;
  let totalInput = 0, totalOutput = 0;
  const toolsUsed: string[] = [];
  const apiMessages = [...messages];
  const turnStart = Date.now();
  let lastResponse: Anthropic.Message | null = null;

  while (true) {
    // GUARD: iteration cap
    if (++iterations > MAX_TOOL_ITERATIONS) {
      throw new Error("Ghostwriter exceeded maximum tool iterations");
    }

    // GUARD: token budget (checked BEFORE the call, not after)
    if (totalInput > MAX_TURN_INPUT_TOKENS) break;

    // GUARD: total turn deadline
    const elapsed = Date.now() - turnStart;
    if (elapsed > TURN_DEADLINE_MS) break;

    // GUARD: per-call timeout (remaining time or API_TIMEOUT_MS, whichever is smaller)
    const remainingMs = Math.min(API_TIMEOUT_MS, TURN_DEADLINE_MS - elapsed);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    let response: Anthropic.Message;
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

    lastResponse = response;
    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;
    logger.log({ step: "ghostwriter_turn", model: MODELS.SONNET, ... });

    if (response.stop_reason !== "tool_use") break;

    // Execute tools — validate blocks, catch errors
    const toolResults = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        if (!block.id || typeof block.name !== "string") continue; // skip malformed
        toolsUsed.push(block.name);
        const result = executeGhostwriterTool(db, personaId, block.name, block.input, state);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }

    // NOTE: tool call/result messages are NOT persisted to DB.
    // Each turn is stateless regarding tools — the draft state carries forward,
    // and conversation text provides context. This means the model may re-call
    // tools like get_author_profile on subsequent turns. This is acceptable —
    // the token cost is modest and it keeps the DB schema simple.
    apiMessages.push({ role: "assistant", content: response.content });
    apiMessages.push({ role: "user", content: toolResults });
  }

  // Extract text from the last non-tool-use response.
  // If the loop exited via budget/deadline break after a tool_use response,
  // lastResponse may have stop_reason "tool_use" with minimal/no text.
  // In that case, return whatever text blocks exist (may be empty).
  const finalResponse = lastResponse;
  if (!finalResponse) throw new Error("Ghostwriter produced no response");

  const assistantMessage = finalResponse.content
    .filter(b => b.type === "text")
    .map(b => (b as any).text).join("\n") || "(Draft updated)";

  const draftChanged = state.currentDraft !== currentDraft;

  // Persist assistant message (user message persisted by route AFTER this succeeds)
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
```

- [ ] **Step 3: Write tests** — prompt builder includes drafts, behavioral instructions, handles empty feedback, respects direct edits, handles termination
- [ ] **Step 4: Run tests, type-check**
- [ ] **Step 5: Commit**

### Task 6: API Endpoints

**Files:** Modify `server/src/routes/generate.ts`, `server/src/schemas/generate.ts`, test

- [ ] **Step 1: Schemas**

```typescript
export const ghostwriteBody = z.object({
  generation_id: z.number().int().positive(),
  message: z.string().trim().min(1),
  current_draft: z.string().optional(), // user's local edits
});

export const selectionBody = z.object({
  selected_draft_indices: z.array(z.number().int().min(0)),
  combining_guidance: z.string().optional(),
});
```

- [ ] **Step 2: Three endpoints**

**`PATCH /api/generate/:id/selection`** — Persists selected_draft_indices and combining_guidance. Persona check.

**`PATCH /api/generate/:id/draft`** — Auto-save endpoint for user's direct edits. Persona check.

**`POST /api/generate/ghostwrite`** — The main endpoint. Includes all safety:

```typescript
// In-memory concurrent request lock
const activeGhostwriteRequests = new Set<number>();

app.post("/api/generate/ghostwrite", async (request, reply) => {
  const personaId = getPersonaId(request);
  const { generation_id, message, current_draft } = validateBody(ghostwriteBody, request.body);

  // GUARD: persona ownership
  const gen = getGeneration(db, generation_id);
  if (!gen) return reply.status(404).send({ error: "Generation not found" });
  if ((gen as any).persona_id !== personaId) {
    return reply.status(403).send({ error: "Not authorized" });
  }

  // GUARD: concurrent request lock
  if (activeGhostwriteRequests.has(generation_id)) {
    return reply.status(429).send({ error: "Request already in progress" });
  }
  activeGhostwriteRequests.add(generation_id);

  const client = getClient();
  const runId = createRun(db, personaId, "ghostwriter", 0);
  const logger = new AiLogger(db, runId);

  try {
    // Load history — use consistent limit (20, matching restore)
    const history = getGenerationMessages(db, generation_id, 20).reverse();
    const messages = history.map(msg => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    // Build system prompt — simplified after first turn
    const isFirstTurn = history.length === 0;
    const drafts: Draft[] = gen.drafts_json ? JSON.parse(gen.drafts_json) : [];
    const selectedIndices: number[] = gen.selected_draft_indices ? JSON.parse(gen.selected_draft_indices) : [];
    const selectedDrafts = selectedIndices.map(i => drafts[i]).filter(Boolean);
    const research = gen.research_id ? getResearch(db, gen.research_id) : null;
    const stories: Story[] = research?.stories_json ? JSON.parse(research.stories_json) : [];
    const story = gen.selected_story_index != null ? stories[gen.selected_story_index] : null;
    const storyContext = story ? `**${story.headline}**\n${story.summary}` : "";

    const systemPrompt = isFirstTurn
      ? buildFirstTurnPrompt(selectedDrafts.length > 0 ? selectedDrafts : drafts, gen.combining_guidance ?? message, storyContext)
      : buildSubsequentTurnPrompt(storyContext);

    // Add user message to the messages array for the API call (NOT yet persisted)
    messages.push({ role: "user" as const, content: message });

    const activeDraft = current_draft ?? gen.final_draft ?? "";

    const result = await ghostwriterTurn(
      client, db, personaId, generation_id, logger,
      messages, systemPrompt, activeDraft
    );

    // Persist user message AFTER success (prevents orphaned messages on failure)
    insertGenerationMessage(db, { generation_id, role: "user", content: message });

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
  } finally {
    activeGhostwriteRequests.delete(generation_id);
  }
});
```

Also add persona checks to the existing `/api/generate/chat` endpoint (pre-existing bug).

- [ ] **Step 3: Fix `GenerationRecord` type** — Add `persona_id: number` to the `GenerationRecord` interface in `generate-queries.ts` so the ownership check doesn't need `(gen as any)`.

- [ ] **Step 4: Tests**

Route tests: 404 for nonexistent generation, 400 for missing message, 403 for wrong persona, 429 for concurrent requests (start a hanging request via mock, fire second, assert 429).

PATCH endpoint tests: selection happy path, draft happy path, 403 for wrong persona on both.

**Create shared mock client** at `server/src/__tests__/helpers/mock-client.ts`:
```typescript
export function mockClient(responses: Partial<Anthropic.Message>[]) {
  let callIndex = 0;
  return {
    messages: {
      create: async () => {
        if (callIndex >= responses.length) throw new Error("Mock client: no more responses");
        return responses[callIndex++];
      },
    },
  } as unknown as Anthropic;
}
```

Agentic loop tests (in `ghostwriter.test.ts`): loop terminates on `end_turn`, loop executes tools and continues, loop stops at MAX_TOOL_ITERATIONS, loop stops at token budget (check fires before call), malformed tool_use block skipped, multiple tools in one response, draft unchanged when update_draft not called, token accounting sums across iterations.

- [ ] **Step 5: Run tests, type-check**
- [ ] **Step 6: Commit**

---

## Chunk 3: Dashboard UI

### Task 7: API Client Methods

**Files:** Modify `dashboard/src/api/client.ts`

- [ ] **Step 1: Add types and methods**

```typescript
export interface GhostwriteResponse {
  message: string;
  draft: string | null;
  change_summary: string | null;
  tools_used: string[];
}

// Add to api object:
ghostwrite: (generationId, message, currentDraft?) => /* POST /api/generate/ghostwrite */,
saveSelection: (generationId, indices, guidance?) => /* PATCH /api/generate/:id/selection */,
saveDraft: (generationId, draft) => /* PATCH /api/generate/:id/draft */,
```

- [ ] **Step 2: Type-check, commit**

### Task 8: GhostwriterChat Component

**Files:** Create `dashboard/src/pages/generate/GhostwriterChat.tsx`

Split-view: chat left, **editable** draft right. Auto-save. Error display. PostRetro button.

Props:
```typescript
interface GhostwriterChatProps {
  gen: { generationId, finalDraft, chatMessages, combiningGuidance };
  setGen: (fn) => void;
  loading: boolean; setLoading: (v) => void;
  onBack: () => void;
  onRetro?: () => void;
}
```

Local state:
```typescript
const [chatInput, setChatInput] = useState("");
const [localDraft, setLocalDraft] = useState(gen.finalDraft);
const [error, setError] = useState<string | null>(null);
const [copied, setCopied] = useState(false);
const [draftHighlight, setDraftHighlight] = useState(false); // for change animation
const localDirtyRef = useRef(false);    // true when user has unsaved edits
const serverDraftRef = useRef(gen.finalDraft); // last known server draft
const startedRef = useRef(false);       // StrictMode guard
const chatEndRef = useRef<HTMLDivElement>(null);
const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
```

**Debounced auto-save** (1.5s after typing stops, cancelled when AI request starts):
```typescript
const cancelSaveTimer = () => {
  if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = undefined; }
};

const debouncedSave = useCallback((draft) => {
  cancelSaveTimer();
  saveTimerRef.current = setTimeout(() => {
    if (gen.generationId) {
      api.saveDraft(gen.generationId, draft).catch(() => {});
      localDirtyRef.current = false;
    }
  }, 1500);
}, [gen.generationId]);
```

**Sync local draft from AI updates — only when user hasn't made unsaved edits:**
```typescript
useEffect(() => {
  serverDraftRef.current = gen.finalDraft;
  if (!localDirtyRef.current) {
    setLocalDraft(gen.finalDraft);
    // Trigger brief highlight animation via CSS class, not key remount
    // (key remount destroys textarea cursor position and undo history)
    setDraftHighlight(true);
    setTimeout(() => setDraftHighlight(false), 500);
  }
}, [gen.finalDraft]);
```

**Draft editing marks dirty flag:**
```typescript
const handleDraftChange = (e) => {
  setLocalDraft(e.target.value);
  localDirtyRef.current = true;
  debouncedSave(e.target.value);
};
```

**StrictMode-safe auto-start:**
```typescript
useEffect(() => {
  if (gen.generationId && gen.chatMessages.length === 0 && !startedRef.current) {
    startedRef.current = true;
    sendMessage(gen.combiningGuidance?.trim() || "Combine these drafts into a single strong post.");
  }
}, [gen.generationId]);
```

**sendMessage** cancels auto-save, uses ref for draft diff, fixes originalDraft null edge case:
```typescript
const sendMessage = async (message) => {
  if (!gen.generationId || !message.trim() || loading) return;
  setLoading(true); setError(null);
  cancelSaveTimer(); // prevent stale auto-save from racing with AI response

  // Optimistic user message
  setGen(prev => ({ ...prev, chatMessages: [...prev.chatMessages, { role: "user", content: message.trim() }] }));
  try {
    // Use ref (not React state) for reliable diff — state may be stale
    const draftChanged = localDraft !== serverDraftRef.current;
    const res = await api.ghostwrite(gen.generationId, message.trim(), draftChanged ? localDraft : undefined);

    // Clear dirty flag — AI has seen our edits
    localDirtyRef.current = false;

    setGen(prev => ({
      ...prev,
      // Set originalDraft on first response (explicit null check, not ||, to handle "" correctly)
      originalDraft: prev.originalDraft != null && prev.originalDraft !== ""
        ? prev.originalDraft
        : (res.draft ?? prev.originalDraft),
      finalDraft: res.draft ?? prev.finalDraft,
      chatMessages: [...prev.chatMessages, { role: "assistant", content: res.message }],
    }));
    setChatInput("");
  } catch (err) {
    setError(err.message ?? "Failed. Try again.");
    setGen(prev => ({ ...prev, chatMessages: prev.chatMessages.slice(0, -1) })); // rollback
  } finally { setLoading(false); }
};
```

**Layout (responsive):**
- Outer: `flex flex-col lg:flex-row min-h-[70vh]` — stacks vertically on small screens, side-by-side on lg+
- Left (`w-full lg:w-1/2`): scrollable message area + input at bottom + error banner
  - **Typing indicator** when `loading`: pulsing dots element as last chat item (3 dots with staggered opacity animation)
  - **Chat input**: `<textarea>` with `onKeyDown` — Enter sends, Shift+Enter inserts newline
  - **Error banner** above input when `error` is set (red, dismissible)
- Right (`w-full lg:w-1/2`): editable `<textarea>` with auto-resize + footer (word count, Run Retro, Copy, Open in LinkedIn)
  - **No key remount** for change animation — use `draftHighlight` CSS class that briefly applies a subtle background pulse, preserving cursor position and undo history
  - Draft textarea: `className={draftHighlight ? "bg-accent/5 transition-colors duration-500" : "transition-colors duration-500"}`
  - **First-turn state**: before AI responds, show sentinel draft with a subtle "Combining drafts..." label above

- [ ] **Step 1: Create component**
- [ ] **Step 2: Type-check, commit**

### Task 9: Wire Into Generate Flow

**Files:** Modify `dashboard/src/pages/Generate.tsx`, `dashboard/src/pages/generate/DraftVariations.tsx`

- [ ] **Step 1: Generate.tsx — replace step 3 with GhostwriterChat**

```typescript
{subTab === "Generate" && step === 3 && (
  <GhostwriterChat
    gen={gen} setGen={setGen} loading={loading} setLoading={setLoading}
    onBack={() => {
      // Clear chat state on back-nav to prevent stale context mixing
      setGen(prev => ({ ...prev, finalDraft: "", originalDraft: "", chatMessages: [] }));
      setStep(2);
    }}
    onRetro={() => setStep(4)}
  />
)}
```

- [ ] **Step 2: DraftVariations — persist selection + set sentinel draft**

Initialize `reviseFeedback` from gen state:
```typescript
const [reviseFeedback, setReviseFeedback] = useState(gen.combiningGuidance ?? "");
```

Replace `handleCombineAndReview`:
```typescript
const handleCombineAndReview = async () => {
  if (gen.generationId === null || selectedCount === 0) return;
  setLoading(true);
  try {
    // 1. Persist selection to DB
    await api.saveSelection(gen.generationId, gen.selectedDraftIndices,
      reviseFeedback || gen.combiningGuidance || undefined);

    // 2. Set sentinel final_draft so restore works even if AI asks before drafting
    const firstDraft = gen.drafts[gen.selectedDraftIndices[0]];
    if (firstDraft) {
      const sentinel = `${firstDraft.hook}\n\n${firstDraft.body}\n\n${firstDraft.closing}`;
      await api.saveDraft(gen.generationId, sentinel);
      setGen(prev => ({ ...prev, finalDraft: sentinel, originalDraft: sentinel,
        combiningGuidance: reviseFeedback || prev.combiningGuidance }));
    }

    onNext();
  } catch (err) { console.error("Failed:", err); }
  finally { setLoading(false); }
};
```

- [ ] **Step 3: Type-check both projects**
- [ ] **Step 4: Smoke test** — full flow: discover → drafts → select → chat → edit draft → AI adapts → copy → refresh → restore
- [ ] **Step 5: Commit**

---

## Chunk 4: Retro Integration & Polish

### Task 10: LLM-Based Principle Storage from Retros

**Files:** Modify `server/src/ai/retro.ts`, `server/src/routes/generate.ts`

- [ ] **Step 1: Implement `storeRetroAsPrinciples`**

Uses Haiku for semantic dedup (~$0.001 per check). Also calls `pruneStaleEditorialPrinciples` before adding new ones.

```typescript
export async function storeRetroAsPrinciples(client, db, personaId, analysis, postCategory?): Promise<void> {
  pruneStaleEditorialPrinciples(db, personaId);
  const existing = getEditorialPrinciples(db, personaId);

  for (const pattern of analysis.patterns) {
    if (existing.length === 0) {
      insertEditorialPrinciple(db, personaId, { principle_text: pattern, source_post_type: postCategory, source_context: analysis.summary });
      continue;
    }
    // LLM dedup via Haiku — "Does this duplicate any existing? Answer with the number or 'none'."
    const matchNum = /* parse Haiku response */;
    if (matchNum valid) confirmPrinciple(db, existing[matchNum - 1].id);
    else insertEditorialPrinciple(db, personaId, { ... });
  }
}
```

- [ ] **Step 2: Call from retro route** — fire-and-forget after `analyzeRetro` succeeds
- [ ] **Step 3: Type-check, commit**

### Task 11: Final Integration Test

- [ ] **Step 1: Full type-check** — both projects
- [ ] **Step 2: Run all tests** — `pnpm test`
- [ ] **Step 3: Full smoke test**

1. Full flow: discover → research → drafts → select → ghostwriter chat
2. 3-4 turn conversation, draft improves each turn
3. Directly edit draft mid-conversation — auto-saves, AI adapts
4. Copy draft, Open in LinkedIn
5. Run retro on published post — principles stored with LLM dedup
6. New generation — `lookup_principles` returns stored principles
7. `lookup_rules` returns existing generation_rules
8. Generation History shows ghostwriter session correctly
9. Refresh mid-conversation — restores to step 3 with chat history
10. Back-nav to step 2 — chat state cleared, can re-enter cleanly
11. Two browser tabs — concurrent request blocked with 429
12. Wrong persona — 403 on ghostwrite

- [ ] **Step 4: Commit** — `git commit -m "feat: ghostwriter chat — complete integration"`
