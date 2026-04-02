# Ghostwriter Agent Enhancement

**Date:** 2026-04-02
**Status:** Approved

## Problem

The ghostwriter chat is stateless across turns — tool call/result messages are discarded after each turn, so the model re-discovers context every time. It has no web search capability (critical for news-based posts), no ability to learn from corrections (add/update writing rules), and no principle-extraction behavior when the user gives feedback.

## Goals

1. **Persistent tool context** — the agent remembers what it looked up and why across the full conversation
2. **Web search in chat** — the agent can research current events and topics mid-conversation, with sources visible in chat but not in the draft
3. **Self-modifying rules** — the agent can add or update writing rules based on user corrections, extracting principles rather than specific instances
4. **Principle extraction** — when the user corrects something, the agent identifies the underlying principle and asks clarifying questions if the right abstraction level is ambiguous

## Non-Goals

- Changing the agent loop architecture (no Agent SDK migration)
- Switching models (stays on Sonnet)
- Changing the research/drafter/combiner pipeline
- Auto-escalation to Opus

## Design

### 1. Persistent Tool Context

**Pattern:** Follows Claude Code's approach — the messages array IS the state. Full Anthropic message format (tool_use + tool_result content blocks) is preserved.

**Storage:** The `generation_messages` table gets a new nullable column `tool_blocks_json` (TEXT) that stores the raw Anthropic content blocks for that turn as JSON. Existing messages get NULL (backward compatible).

**Replay:** When building the messages array for an API call, tool blocks are reconstructed from DB alongside chat messages. The full conversation including tool interactions is sent to the model.

**Microcompaction:** Before each API call, apply Claude Code's compaction heuristic:
- Keep last 5 turns fully hydrated (all tool_use + tool_result content intact)
- Older turns: preserve tool_use blocks (knowing what it searched for is cheap context) but replace tool_result content with `[Old tool result content cleared]`
- This keeps token usage bounded while preserving the reasoning chain

### 2. New Tools

#### `web_search`

Calls the existing `searchWithSonarPro()` function from `server/src/ai/perplexity.ts`. Takes a search query, returns synthesized content + source citations.

The agent can call this multiple times per turn (up to the 10-iteration cap) to iteratively research — search, evaluate results, refine query, search again. This mirrors the Claude Code pattern where the model naturally iterates with search tools.

Sources are included in the agent's chat message but NOT in the draft text.

```typescript
{
  name: "web_search",
  description: "Search the web for current information on a topic. Returns content with source citations. Use to research news, verify claims, or find context for the post topic. You can search multiple times to build understanding.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" }
    },
    required: ["query"]
  }
}
```

#### `fetch_url`

Fetches a specific URL, extracts article content using Mozilla Readability + jsdom, returns clean text + title. For when the agent sees a specific source in search results it wants to read in full.

Falls back to simple tag-stripping for non-article pages.

```typescript
{
  name: "fetch_url",
  description: "Fetch and read a specific web page. Returns extracted article text, not raw HTML. Use when you need the full content of a specific URL from search results.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch and read" }
    },
    required: ["url"]
  }
}
```

**New dependencies:** `@mozilla/readability`, `jsdom`

#### `add_or_update_rule`

Creates a new writing rule or updates an existing one by ID. Rules created by the agent are marked with `origin: 'auto'`. Before adding, the agent should call `get_rules` to check for existing rules that cover the same territory — broaden an existing rule rather than creating duplicates.

```typescript
{
  name: "add_or_update_rule",
  description: "Add a new writing rule or update an existing one. Use when the user expresses a correction or preference that should persist across future posts. IMPORTANT: Before adding, check existing rules with get_rules to avoid duplicates. If a similar rule exists, update it instead. Always formulate rules at the PRINCIPLE level, not specific instances.",
  input_schema: {
    type: "object",
    properties: {
      rule_id: { type: "number", description: "ID of existing rule to update (omit to create new)" },
      category: { type: "string", enum: ["voice_tone", "structure_formatting", "anti_ai_tropes"], description: "Rule category" },
      rule_text: { type: "string", description: "The rule, stated as a principle" },
      example_text: { type: "string", description: "Optional example illustrating the rule" }
    },
    required: ["category", "rule_text"]
  }
}
```

#### `get_rules` (renamed from `lookup_rules`)

Same as before but now returns the rule ID and origin (manual/auto) so the agent can identify rules it previously created and update them.

### 3. Principle-Extraction Prompting

Added to the ghostwriter system prompt. Governs how the agent handles corrections:

**Detection:** Recognize corrections — "don't do that," "never use X," "make sure you always Y," "that sounds like AI," etc.

**Assess clarity:** Is the underlying principle obvious or ambiguous?
- Clear: "never use emoji" — the principle IS the instruction
- Ambiguous: "that sounds weird" — could be word choice, tone, structure, audience mismatch

**If ambiguous, ask one question** to find the right abstraction level: "Is it specifically that you don't want the word 'landscape,' or more broadly that I should avoid overused tech/business metaphors?"

**Save at the principle level:** Not "don't say landscape" but "avoid dead metaphors common in tech/business writing (landscape, ecosystem, leverage, etc.)"

**Check before adding:** Call `get_rules` first. If an existing rule covers this territory, broaden or refine it rather than creating a new one.

**Confirm what was saved:** "Added a rule: avoid dead metaphors common in tech/business writing. I'll watch for these going forward."

### 4. Frontend Changes

**Search status indicator:** When the agent is using web_search or fetch_url, show status text in the typing indicator area ("Searching the web..." / "Reading article..."). The existing `tools_used` field in the API response already carries this info. Add a lightweight mechanism to surface status during the turn (not just after).

**Rule additions in chat:** No special UI — the agent mentions rule additions in its chat message naturally.

**Rules settings page:** Auto-generated rules get a subtle "auto" badge to distinguish from manually written ones. Users can edit or delete auto rules the same as manual ones.

### 5. Database Changes

**Migration: add `tool_blocks_json` to `generation_messages`**
```sql
ALTER TABLE generation_messages ADD COLUMN tool_blocks_json TEXT;
```

**Migration: add `origin` to `generation_rules`**
```sql
ALTER TABLE generation_rules ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
```

No new tables. Both changes are backward compatible with defaults.

### 6. Files Modified

| File | Change |
|------|--------|
| `server/src/ai/ghostwriter.ts` | Persistent tool context replay, microcompaction, updated system prompt |
| `server/src/ai/ghostwriter-tools.ts` | New tools: web_search, fetch_url, add_or_update_rule; rename lookup_rules to get_rules |
| `server/src/routes/generate.ts` | Ghostwrite route stores/replays tool blocks |
| `server/src/db/generate-queries.ts` | Queries for rule origin, tool block storage/retrieval |
| `dashboard/src/pages/generate/GhostwriterChat.tsx` | Search status indicator during turns |
| Rules settings UI component | Auto badge on auto-generated rules |
| `server/src/db/migrations/` | New migration for column additions |

**New dependencies:** `@mozilla/readability`, `jsdom`

### 7. Token Budget Considerations

The persistent context will increase input tokens per turn as conversations grow. Mitigations:
- Microcompaction (clearing old tool results) keeps growth bounded
- The existing MAX_TURN_INPUT_TOKENS guard (30K) catches runaway costs
- May need to increase this limit slightly given richer context — evaluate after implementation
- Web search results should be truncated to a reasonable length before returning to the model
