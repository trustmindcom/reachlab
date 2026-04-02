import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import type { Draft } from "@reachlab/shared";
import { MODELS } from "./client.js";
import { GHOSTWRITER_TOOLS, createGhostwriterState, executeGhostwriterTool } from "./ghostwriter-tools.js";
import { insertGenerationMessage } from "../db/generate-queries.js";
import type { AiLogger } from "./logger.js";
import { agentTurn } from "./agent-loop.js";

// Re-export so existing imports from ghostwriter.js keep working
export { expandMessageRow, CLEARED_TOOL_RESULT, type StoredToolBlock } from "./agent-loop.js";

// ── Safety constants ───────────────────────────────────────

export const MAX_TOOL_ITERATIONS = 10;
export const API_TIMEOUT_MS = 30_000;       // 30s per API call
export const TURN_DEADLINE_MS = 60_000;     // 60s total turn deadline
export const MAX_TURN_INPUT_TOKENS = 30_000; // ~$0.10 worst case per turn

// ── Result type ────────────────────────────────────────────

export interface GhostwriterTurnResult {
  assistantMessage: string;
  draft: string | null;
  changeSummary: string | null;
  toolsUsed: string[];
  input_tokens: number;
  output_tokens: number;
}

// ── System prompt builders ─────────────────────────────────

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
SURFACE (generic, cliché, abstract) → "Can you make that more concrete? Give me a specific example."
ENERGY (they get more specific) → "Say more about that."
CASUAL ASIDE ("oh, and also...") → "Wait — say that again. What's behind that?"
CONTRADICTION with something earlier → "Interesting — earlier you said X, but now Y. How do those fit together?"
EXHAUSTED thread (clear, complete answer) → Brief acknowledge, move on.

## Draft Updates

When you update the draft, always use the update_draft tool with the FULL draft text (not a diff).
After updating, explain what you changed in 1-2 sentences, then ask ONE focused question to guide the next refinement.`;

export function buildFirstTurnPrompt(
  selectedDrafts: Draft[],
  userFeedback: string,
  storyContext: string
): string {
  const draftsSection = selectedDrafts
    .map((d, i) => `### Draft ${i + 1} (${d.type})\n**Hook:** ${d.hook}\n\n${d.body}\n\n**Closing:** ${d.closing}`)
    .join("\n\n");

  return `You are a LinkedIn ghostwriter. The user has selected draft variations and wants you to combine and refine them into a single strong post through conversation.

## Selected Drafts
${draftsSection || "(No drafts provided)"}

## User's Guidance
${userFeedback || "(No specific guidance)"}

${storyContext ? `## Story Context\n${storyContext}\n` : ""}
${BEHAVIORAL_INSTRUCTIONS}`;
}

export function buildSubsequentTurnPrompt(storyContext: string): string {
  return `You are a LinkedIn ghostwriter helping refine a draft through conversation. The draft is being edited in a side panel — the user can see and edit it directly.

${storyContext ? `## Story Context\n${storyContext}\n` : ""}
${BEHAVIORAL_INSTRUCTIONS}`;
}

// ── Agentic loop ───────────────────────────────────────────

export async function ghostwriterTurn(
  client: Anthropic,
  db: Database.Database,
  personaId: number,
  generationId: number,
  logger: AiLogger,
  messages: Array<{ role: "user" | "assistant"; content: string | Anthropic.Messages.ContentBlockParam[] }>,
  systemPrompt: string,
  currentDraft: string
): Promise<GhostwriterTurnResult> {
  const state = createGhostwriterState(currentDraft);

  const result = await agentTurn({
    client,
    model: MODELS.SONNET,
    tools: GHOSTWRITER_TOOLS,
    executeTool: (name, input) => executeGhostwriterTool(db, personaId, name, input, state, logger),
    systemPrompt,
    messages,
    logger,
    maxIterations: MAX_TOOL_ITERATIONS,
    maxInputTokens: MAX_TURN_INPUT_TOKENS,
    turnDeadlineMs: TURN_DEADLINE_MS,
    apiTimeoutMs: API_TIMEOUT_MS,
  });

  const draftChanged = state.currentDraft !== currentDraft;

  // Persist assistant message (user message persisted by route AFTER this succeeds)
  insertGenerationMessage(db, {
    generation_id: generationId,
    role: "assistant",
    content: result.assistantMessage,
    draft_snapshot: draftChanged ? state.currentDraft : undefined,
    tool_blocks_json: result.toolBlockLog.length > 0 ? JSON.stringify(result.toolBlockLog) : undefined,
  });

  return {
    assistantMessage: result.assistantMessage,
    draft: draftChanged ? state.currentDraft : null,
    changeSummary: draftChanged ? state.lastChangeSummary : null,
    toolsUsed: result.toolsUsed,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
  };
}
