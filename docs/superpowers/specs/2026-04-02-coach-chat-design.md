# Interactive Coach Chat

**Date:** 2026-04-02
**Status:** Approved

## Problem

The coaching system is batch-only — it runs periodic analysis and proposes changes for the user to accept/reject. When the user wants to dig into why posts are underperforming, explore strategy, or understand trends, there's no interactive way to do that. The data exists (post metrics, categories, timing, engagement, topics, hooks) but it's only accessible through static dashboard views.

## Goals

1. **Interactive coaching chat** — a conversational agent that can query analytics data, research external factors, and provide data-backed advice
2. **Converged agent architecture** — extract the ghostwriter's agent loop, shared tools, and chat UI into reusable modules so both flows share infrastructure
3. **Slide-out panel** — accessible from Overview and Coach pages without navigating away

## Non-Goals

- Replacing the existing Coach page (it stays as-is, the chat augments it)
- Changing the batch coaching analyzer or sync flow
- Multi-user or multi-session-at-once support

## Design

### 1. Converged Agent Loop

Extract the agentic while loop from `ghostwriter.ts` into a generic `agent-loop.ts` module.

**New file: `server/src/ai/agent-loop.ts`**

```typescript
interface AgentTurnConfig {
  client: Anthropic;
  model: string;
  tools: Tool[];
  executeTool: (name: string, input: Record<string, unknown>) => string | Promise<string>;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: any }>;
  logger: AiLogger;
  maxIterations?: number;       // default 10
  maxInputTokens?: number;      // default 30_000
  turnDeadlineMs?: number;      // default 60_000
  apiTimeoutMs?: number;        // default 30_000
}

interface AgentTurnResult {
  assistantMessage: string;
  toolsUsed: string[];
  toolBlockLog: StoredToolBlock[];
  input_tokens: number;
  output_tokens: number;
}

async function agentTurn(config: AgentTurnConfig): Promise<AgentTurnResult>
```

Contains the while loop, guards (iteration cap, token budget, deadline, timeout), tool execution, tool block collection, and result extraction. The `StoredToolBlock` type, `expandMessageRow`, and `CLEARED_TOOL_RESULT` constant also live here.

**`ghostwriterTurn`** becomes a thin wrapper that:
- Assembles ghostwriter-specific tools and system prompt
- Calls `agentTurn`
- Manages `GhostwriterState` (draft updates) by wrapping `executeTool`
- Persists the result to `generation_messages`

**`coachChatTurn`** is a new thin wrapper that:
- Assembles coach-specific tools and system prompt
- Calls `agentTurn`
- Persists the result to `coach_chat_messages`

### 2. Shared Tools

**New file: `server/src/ai/shared-tools.ts`**

Extract from `ghostwriter-tools.ts` into a shared module:
- `web_search` tool definition + dispatch (calls `chatWebSearch`)
- `fetch_url` tool definition + dispatch (calls `fetchUrl`)
- `get_rules` tool definition + dispatch (calls `getRules`)
- `add_or_update_rule` tool definition + dispatch (calls `updateRule`/`insertSingleRule`)

Both `ghostwriter-tools.ts` and `coach-chat-tools.ts` import from `shared-tools.ts` and merge the shared tool definitions with their domain-specific ones.

### 3. Coach Chat Tools

**New file: `server/src/ai/coach-chat-tools.ts`**

7 coaching-specific tools plus the 4 shared tools:

**`query_posts`** — Search/filter posts by date range, topic, category, sort_by, limit. Returns post text + performance metrics (impressions, ER, reactions, comments, reposts, saves). SQL queries the `posts` + `post_metrics` tables with optional WHERE clauses.

**`get_performance_summary`** — Overall stats for a time period. Total posts, average impressions, average engagement rate, comparison vs prior period of same length. Queries `posts` + `post_metrics` with date filtering and aggregation.

**`get_category_breakdown`** — Categories with post count, median engagement rate, status (reliable/declining/underexplored). Queries `ai_tags` + `post_metrics` grouped by category. Reuses the same categorization logic as the Coach Deep Dive tab.

**`get_topic_performance`** — Topics ranked by engagement. Queries `ai_tags` with topic-level grouping and engagement metrics.

**`get_timing_analysis`** — Best days and hours based on historical engagement data. Queries `posts` with day-of-week and hour extraction, grouped by time slot with average engagement rates.

**`get_engagement_quality`** — Breakdown of engagement types: reactions vs comments vs saves ratio, comment-to-impression rate. Queries `post_metrics` with aggregation.

**`get_hook_analysis`** — Hook types and format styles ranked by performance. Queries `ai_tags` where tag type is hook_type or format_style, joined with `post_metrics`.

### 4. Coach System Prompt

```
You are a LinkedIn performance coach. You have access to the user's complete post analytics — performance metrics, content categories, timing data, engagement quality, and writing rules. Use your tools to pull data before giving advice.

## Behavior

- Always cite specific numbers when making claims ("your ER dropped from 4.2% to 2.1% over the last 2 weeks")
- Pull data BEFORE giving advice. Don't speculate when you can query.
- Be direct — if something isn't working, say so clearly.
- ONE question at a time if you need clarification.
- Keep responses focused. This is a coaching conversation, not a lecture.

## Web Research

When the user asks about external factors (algorithm changes, platform trends, competitor activity):
- Use web_search to find current information
- Use fetch_url for specific articles
- Mention sources in chat

## Learning from Corrections

[Same principle-extraction behavior as ghostwriter — shared prompt section]
```

### 5. Database

**New migration:**

```sql
CREATE TABLE coach_chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL,
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

Separate from `generation_messages` because coach chats have a different lifecycle — not tied to a generation, can span topics, multiple sessions over time. The `tool_blocks_json` column uses the same format so `expandMessageRow` works on both.

**New query functions** in `server/src/db/coach-chat-queries.ts`:
- `createCoachSession(db, personaId, title?)`
- `getCoachSession(db, sessionId)`
- `listCoachSessions(db, personaId, limit)`
- `insertCoachMessage(db, { session_id, role, content, tool_blocks_json? })`
- `getCoachMessages(db, sessionId, limit)`

### 6. Routes

**New file: `server/src/routes/coach-chat.ts`**

- `POST /api/coach/chat` — send message to coach. Body: `{ session_id, message }`. Creates session on first message if session_id is null. Returns `{ session_id, message, tools_used }`.
- `GET /api/coach/chat/sessions` — list sessions for persona. Returns `{ sessions: [{ id, title, created_at }] }`.
- `POST /api/coach/chat/sessions` — create new empty session. Returns `{ session_id }`.
- `GET /api/coach/chat/sessions/:id/messages` — get messages. Returns array with `expandMessageRow`-compatible format for history display.

### 7. Frontend

**Shared chat component: `dashboard/src/components/AgentChat.tsx`**

Extracted from `GhostwriterChat.tsx`. Contains:
- Message bubble rendering (user/assistant with configurable styles)
- Chat input textarea with Enter-to-send
- Typing indicator (animated dots)
- Tool usage badges (Searched the web, Read article, Updated rules + coach-specific badges)
- Auto-scroll to bottom
- Error banner with dismiss

Props:
```typescript
interface AgentChatProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  loading: boolean;
  placeholder?: string;
  className?: string;
  userBubbleClass?: string;
  assistantBubbleClass?: string;
}
```

**Refactored `GhostwriterChat.tsx`**: Keeps the split-view layout (chat left, draft right) but uses `AgentChat` for the chat panel. Draft editing, auto-save, copy/LinkedIn buttons stay here.

**New: `dashboard/src/components/CoachChatPanel.tsx`**

Slide-out panel (~400px wide, right side) containing:
- Session selector dropdown + "New chat" button in header
- `AgentChat` component with main-app palette styling
- Close button

**Trigger**: "Chat with Coach" button on Overview and Coach pages. Toggles the panel open/closed. Panel state persisted in component state (not URL).

### 8. Files Modified/Created

| File | Change |
|------|--------|
| **Create** `server/src/ai/agent-loop.ts` | Generic agent turn loop, expandMessageRow, microcompaction |
| **Create** `server/src/ai/shared-tools.ts` | Shared tool definitions + dispatch (web_search, fetch_url, get_rules, add_or_update_rule) |
| **Create** `server/src/ai/coach-chat-tools.ts` | Coach-specific tool definitions + dispatch |
| **Create** `server/src/ai/coach-chat.ts` | System prompt, coachChatTurn wrapper |
| **Create** `server/src/routes/coach-chat.ts` | Route handlers |
| **Create** `server/src/db/coach-chat-queries.ts` | DB query functions |
| **Create** `dashboard/src/components/AgentChat.tsx` | Shared chat UI component |
| **Create** `dashboard/src/components/CoachChatPanel.tsx` | Slide-out panel |
| **Modify** `server/src/ai/ghostwriter.ts` | Extract agent loop, use `agentTurn` from agent-loop.ts |
| **Modify** `server/src/ai/ghostwriter-tools.ts` | Extract shared tools, import from shared-tools.ts |
| **Modify** `dashboard/src/pages/generate/GhostwriterChat.tsx` | Use shared AgentChat component |
| **Modify** `dashboard/src/pages/Coach.tsx` | Add coach chat trigger button |
| **Modify** `dashboard/src/pages/Overview.tsx` (or equivalent) | Add coach chat trigger button |
| **Modify** `server/src/app.ts` | Register coach-chat routes |
| **Create** `server/src/db/migrations/026-coach-chat.sql` | New tables |
| **Modify** `dashboard/src/api/client.ts` | Coach chat API methods |

### 9. No New Dependencies

All infrastructure already exists: Anthropic SDK (via OpenRouter), better-sqlite3, @mozilla/readability, jsdom. No new packages needed.
