import type Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import type { AiLogger } from "./logger.js";

// ── Tool block persistence & replay ──────────────────────

export const CLEARED_TOOL_RESULT = "[Old tool result content cleared]";

export interface StoredToolBlock {
  role: "assistant" | "user";
  content: any;
}

export function expandMessageRow(
  row: { role: string; content: string; tool_blocks_json: string | null },
  isRecent: boolean
): Array<{ role: "user" | "assistant"; content: any }> {
  if (!row.tool_blocks_json) {
    return [{ role: row.role as "user" | "assistant", content: row.content }];
  }

  let toolBlocks: StoredToolBlock[];
  try {
    toolBlocks = JSON.parse(row.tool_blocks_json);
  } catch {
    return [{ role: row.role as "user" | "assistant", content: row.content }];
  }
  const messages: Array<{ role: "user" | "assistant"; content: any }> = [];

  for (const block of toolBlocks) {
    if (!isRecent && block.role === "user" && Array.isArray(block.content)) {
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

  if (row.role === "assistant") {
    messages.push({ role: "assistant", content: row.content });
  }

  return messages;
}

// ── Config & result types ─────────────────────────────────

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

// ── Generic agent turn loop ───────────────────────────────

export async function agentTurn(config: AgentTurnConfig): Promise<AgentTurnResult> {
  const {
    client,
    model,
    tools,
    executeTool,
    systemPrompt,
    messages,
    logger,
    maxIterations = 10,
    maxInputTokens = 30_000,
    turnDeadlineMs = 60_000,
    apiTimeoutMs = 30_000,
    maxTokens = 4000,
  } = config;

  let iterations = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const toolsUsed: string[] = [];
  const toolBlockLog: StoredToolBlock[] = [];
  const apiMessages: Array<{ role: "user" | "assistant"; content: any }> = [...messages];
  const turnStart = Date.now();
  let lastResponse: Anthropic.Messages.Message | null = null;

  while (true) {
    // GUARD: iteration cap
    if (++iterations > maxIterations) {
      throw new Error("Agent exceeded maximum tool iterations");
    }

    // GUARD: token budget (checked BEFORE the call, not after)
    if (totalInput > maxInputTokens) break;

    // GUARD: total turn deadline
    const elapsed = Date.now() - turnStart;
    if (elapsed > turnDeadlineMs) break;

    // GUARD: per-call timeout (remaining time or apiTimeoutMs, whichever is smaller)
    const remainingMs = Math.min(apiTimeoutMs, turnDeadlineMs - elapsed);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    const iterStart = Date.now();

    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          tools,
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
      step: "agent_turn",
      model,
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
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }

    apiMessages.push({ role: "assistant", content: response.content });
    apiMessages.push({ role: "user", content: toolResults });

    // Collect for persistence
    toolBlockLog.push({ role: "assistant", content: response.content });
    toolBlockLog.push({ role: "user", content: toolResults });
  }

  // Extract text from the last response
  if (!lastResponse) throw new Error("Agent produced no response");

  const assistantMessage =
    lastResponse.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n") || "(Draft updated)";

  return {
    assistantMessage,
    toolsUsed,
    toolBlockLog,
    input_tokens: totalInput,
    output_tokens: totalOutput,
  };
}
