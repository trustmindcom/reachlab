import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import type { Draft } from "@reachlab/shared";
import { MODELS } from "./client.js";
import { GHOSTWRITER_TOOLS, createGhostwriterState, executeGhostwriterTool } from "./ghostwriter-tools.js";
import { insertGenerationMessage } from "../db/generate-queries.js";
import type { AiLogger } from "./logger.js";

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
  let iterations = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const toolsUsed: string[] = [];
  const apiMessages: Array<{ role: "user" | "assistant"; content: any }> = [...messages];
  const turnStart = Date.now();
  let lastResponse: Anthropic.Messages.Message | null = null;

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
    const iterStart = Date.now();

    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create(
        {
          model: MODELS.SONNET,
          max_tokens: 4000,
          system: systemPrompt,
          tools: GHOSTWRITER_TOOLS,
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

    logger.log({
      step: "ghostwriter_turn",
      model: MODELS.SONNET,
      input_messages: JSON.stringify(apiMessages.slice(-1)),
      output_text: JSON.stringify(response.content),
      tool_calls: null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: 0,
      duration_ms: Date.now() - iterStart,
    });

    if (response.stop_reason !== "tool_use") break;

    // Execute tools — validate blocks, catch errors
    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        // Validate tool_use blocks
        if (!block.id || typeof block.name !== "string") continue;
        toolsUsed.push(block.name);
        const result = executeGhostwriterTool(
          db,
          personaId,
          block.name,
          block.input as Record<string, unknown>,
          state
        );
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }

    // NOTE: tool call/result messages are NOT persisted to DB.
    apiMessages.push({ role: "assistant", content: response.content });
    apiMessages.push({ role: "user", content: toolResults });
  }

  // Extract text from the last response
  if (!lastResponse) throw new Error("Ghostwriter produced no response");

  const assistantMessage =
    lastResponse.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n") || "(Draft updated)";

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
