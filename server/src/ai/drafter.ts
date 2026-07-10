import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { jsonrepair } from "jsonrepair";
import { MODELS } from "./client.js";
import { streamWithIdleTimeout } from "./stream-with-idle.js";
import { AiLogger } from "./logger.js";
import { assemblePrompt } from "./prompt-assembler.js";
import type { Draft } from "../db/generate-queries.js";
import { renderWritingContext, type WritingContext } from "./writing-context.js";

export interface DraftResult {
  drafts: Draft[];
  prompt_snapshot: string;
  input_tokens: number;
  output_tokens: number;
}

const VARIATION_INSTRUCTIONS: Record<string, string> = {
  contrarian:
    "Write a CONTRARIAN variation. Challenge the obvious take. Lead with what most people get wrong about this topic. Be specific about why the conventional wisdom fails.",
  operator:
    "Write an OPERATOR variation. Ground the post in practitioner perspective — the kind of thing someone who has done the work would notice. If an Author Profile is provided in the system prompt, draw on those specific experiences. If NOT, write from a general practitioner's viewpoint without inventing specific personal details (no fake companies, timelines, or projects).",
  future:
    "Write a FUTURE-FACING variation. Extrapolate from the author's controlling intent to what it means 2-5 years out. Make a specific prediction grounded in the author's argument. When evidence is provided, use it only as factual support; it may inform but must not replace or redefine the intent. Be bold but defensible.",
};

export type DraftLength = "short" | "medium" | "long";

export const LENGTH_RANGES: Record<DraftLength, { min: number; max: number }> = {
  short: { min: 80, max: 120 },
  medium: { min: 150, max: 250 },
  long: { min: 300, max: 450 },
};

export const LENGTH_INSTRUCTIONS: Record<DraftLength, string> = {
  short: "Target approximately 80-120 words. Be extremely concise — one sharp hook, one clear argument, one strong close. Cut everything that isn't load-bearing.",
  medium: "Target approximately 150-250 words. One clear argument with enough room to develop the idea and provide one key piece of supporting evidence.",
  long: "Target approximately 300-450 words. Develop the argument fully with evidence, examples, and nuance. Still one idea — just explored in depth.",
};

/**
 * Generate 3 draft variations (contrarian, operator, future-facing).
 */
export async function generateDrafts(
  client: Anthropic,
  db: Database.Database,
  personaId: number,
  logger: AiLogger,
  context: WritingContext,
  personalConnection?: string,
  length?: DraftLength
): Promise<DraftResult> {
  const writingContext = renderWritingContext(context);
  const connectionContext = personalConnection
    ? `\n\n## Personal Connection\n${personalConnection}`
    : "";
  const lengthContext = length ? `\n\n## Length\n${LENGTH_INSTRUCTIONS[length]}` : "";
  const assembled = assemblePrompt(db, personaId, "");

  const draftPromises = Object.entries(VARIATION_INSTRUCTIONS).map(
    async ([variationType, instruction]): Promise<{ draft: Draft; input_tokens: number; output_tokens: number }> => {
      const start = Date.now();
      const { text, input_tokens, output_tokens, thinking_tokens } = await streamWithIdleTimeout(client, {
        model: MODELS.SONNET,
        max_tokens: 2000,
        system: assembled.system,
        messages: [
          {
            role: "user",
            content: `${writingContext}

${instruction}${connectionContext}${lengthContext}

Return JSON:
{
  "hook": "string — the opening 1-2 sentences that stop the scroll",
  "body": "string — the main content, use \\n for line breaks",
  "closing": "string — the closing question or reflection",
  "word_count": number,
  "structure_label": "string — brief description like 'Contrarian take with personal evidence'"
}`,
          },
        ],
      });

      const duration = Date.now() - start;

      logger.log({
        step: `draft_${variationType}`,
        model: MODELS.SONNET,
        input_messages: JSON.stringify([{ role: "user", content: instruction }]),
        output_text: text,
        tool_calls: null,
        input_tokens,
        output_tokens,
        thinking_tokens,
        duration_ms: duration,
      });

      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`Draft ${variationType} response did not contain valid JSON`);
      }

      const parsed = JSON.parse(jsonrepair(jsonMatch[0]));
      return {
        draft: {
          type: variationType as Draft["type"],
          hook: parsed.hook,
          body: parsed.body,
          closing: parsed.closing,
          word_count: parsed.word_count ?? 0,
          structure_label: parsed.structure_label ?? variationType,
        },
        input_tokens,
        output_tokens,
      };
    }
  );

  const results = await Promise.all(draftPromises);
  const drafts = results.map((r) => r.draft);
  const totalInput = results.reduce((sum, r) => sum + r.input_tokens, 0);
  const totalOutput = results.reduce((sum, r) => sum + r.output_tokens, 0);

  return {
    drafts,
    prompt_snapshot: `${assembled.system}\n\n${writingContext}`,
    input_tokens: totalInput,
    output_tokens: totalOutput,
  };
}

/**
 * Revise all 3 drafts based on user feedback about what they do/don't like.
 */
export async function reviseDrafts(
  client: Anthropic,
  db: Database.Database,
  personaId: number,
  logger: AiLogger,
  context: WritingContext,
  currentDrafts: Draft[],
  feedback: string,
  length?: DraftLength
): Promise<DraftResult> {
  const assembled = assemblePrompt(db, personaId, "");
  const writingContext = renderWritingContext(context);
  const lengthContext = length ? `\n\n## Length\n${LENGTH_INSTRUCTIONS[length]}` : "";

  const draftPromises = currentDrafts.map(
    async (draft, i): Promise<{ draft: Draft; input_tokens: number; output_tokens: number }> => {
      const start = Date.now();
      const currentDraftData = JSON.stringify({
        type: draft.type,
        hook: draft.hook,
        body: draft.body,
        closing: draft.closing,
      });
      const feedbackData = JSON.stringify(feedback);

      const { text, input_tokens, output_tokens, thinking_tokens } = await streamWithIdleTimeout(client, {
        model: MODELS.SONNET,
        max_tokens: 2000,
        system: assembled.system,
        messages: [
          {
            role: "user",
            content: `${writingContext}

## SELECTED DRAFT TO REVISE

Selected draft data: ${currentDraftData}

## FEEDBACK

The user reviewed the selected drafts and gave this feedback data:
${feedbackData}

Rewrite this selected variation to address the feedback. Preserve the variation characteristics represented in the selected draft data while incorporating what the user wants changed.${lengthContext}

Return JSON:
{
  "hook": "string — the opening 1-2 sentences that stop the scroll",
  "body": "string — the main content, use \\n for line breaks",
  "closing": "string — the closing question or reflection",
  "word_count": number,
  "structure_label": "string — brief description like 'Contrarian take with personal evidence'"
}`,
          },
        ],
      });

      const duration = Date.now() - start;

      logger.log({
        step: `revise_${draft.type}`,
        model: MODELS.SONNET,
        input_messages: JSON.stringify([{ role: "user", content: `Revise ${draft.type}: ${feedback}` }]),
        output_text: text,
        tool_calls: null,
        input_tokens,
        output_tokens,
        thinking_tokens,
        duration_ms: duration,
      });

      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`Revised draft ${draft.type} response did not contain valid JSON`);
      }

      const parsed = JSON.parse(jsonrepair(jsonMatch[0]));
      return {
        draft: {
          type: draft.type,
          hook: parsed.hook,
          body: parsed.body,
          closing: parsed.closing,
          word_count: parsed.word_count ?? 0,
          structure_label: parsed.structure_label ?? draft.type,
        },
        input_tokens,
        output_tokens,
      };
    }
  );

  const results = await Promise.all(draftPromises);
  const drafts = results.map((r) => r.draft);
  const totalInput = results.reduce((sum, r) => sum + r.input_tokens, 0);
  const totalOutput = results.reduce((sum, r) => sum + r.output_tokens, 0);

  return {
    drafts,
    prompt_snapshot: `${assembled.system}\n\n${writingContext}`,
    input_tokens: totalInput,
    output_tokens: totalOutput,
  };
}
