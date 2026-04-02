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
