import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./client.js";
import { streamWithIdleTimeout } from "./stream-with-idle.js";
import { AiLogger } from "./logger.js";
import type { Draft } from "../db/generate-queries.js";
import { type DraftLength, LENGTH_RANGES } from "./drafter.js";

export interface CombineResult {
  final_draft: string;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Combine 2+ selected drafts into a single final draft using optional guidance.
 * If only 1 draft is selected, returns it as-is (formatted as full text).
 * When draftLength is provided, enforces word count — if the combined draft exceeds
 * the target range by >20%, bounces it back to the LLM for tightening.
 */
export async function combineDrafts(
  client: Anthropic,
  logger: AiLogger,
  drafts: Draft[],
  selectedIndices: number[],
  guidance?: string,
  systemPrompt?: string,
  draftLength?: DraftLength
): Promise<CombineResult> {
  const selected = selectedIndices.map((i) => drafts[i]).filter(Boolean);

  if (selected.length === 0) {
    throw new Error("No drafts selected for combining");
  }

  // Single draft — just format and return
  if (selected.length === 1) {
    const d = selected[0];
    const fullText = `${d.hook}\n\n${d.body}\n\n${d.closing}`;
    return { final_draft: fullText, input_tokens: 0, output_tokens: 0 };
  }

  // Multiple drafts — combine via LLM
  const draftsText = selected
    .map(
      (d, i) =>
        `--- Draft ${i + 1} (${d.type}) ---\nHook: ${d.hook}\n\nBody:\n${d.body}\n\nClosing: ${d.closing}`
    )
    .join("\n\n");

  const lengthConstraint = draftLength
    ? ` The final post MUST be ${LENGTH_RANGES[draftLength].min}-${LENGTH_RANGES[draftLength].max} words.`
    : "";

  const guidanceText = guidance
    ? `\n\nUser guidance for combining: "${guidance}"`
    : "";

  const prompt = `Combine these ${selected.length} LinkedIn post drafts into a single cohesive post. Take the strongest elements from each — the best hook, the most compelling evidence, the sharpest closing.${lengthConstraint}${guidanceText}

${draftsText}

Return the combined post as plain text (no JSON, no markdown headers). Use line breaks between paragraphs.`;

  const start = Date.now();
  const combineResult = await streamWithIdleTimeout(client, {
    model: MODELS.SONNET,
    max_tokens: 2000,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: [{ role: "user", content: prompt }],
  });

  const duration = Date.now() - start;
  let text = combineResult.text;

  logger.log({
    step: "combine",
    model: MODELS.SONNET,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: combineResult.input_tokens,
    output_tokens: combineResult.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  let totalInput = combineResult.input_tokens;
  let totalOutput = combineResult.output_tokens;

  // Tightening pass — if the combined draft exceeds the target by >20%
  if (draftLength) {
    const range = LENGTH_RANGES[draftLength];
    const wordCount = text.trim().split(/\s+/).length;

    if (wordCount > range.max * 1.2) {
      const tightenPrompt = `This LinkedIn post is ${wordCount} words but needs to be ${range.min}-${range.max} words.

WRITING PRINCIPLES TO GUIDE CUTS:
${systemPrompt ?? "(none provided)"}

Tighten this post. Cut what doesn't carry weight. Sharpen sentences. Don't summarize — keep the voice and the strongest material. Remove filler, merge redundant points, eliminate anything that restates what's already implied.

POST:
${text}

Return only the tightened post as plain text.`;

      const tightenStart = Date.now();
      const tightenResult = await streamWithIdleTimeout(client, {
        model: MODELS.SONNET,
        max_tokens: 2000,
        messages: [{ role: "user", content: tightenPrompt }],
      });

      const tightenDuration = Date.now() - tightenStart;

      logger.log({
        step: "combine_tighten",
        model: MODELS.SONNET,
        input_messages: JSON.stringify([
          { role: "user", content: tightenPrompt },
        ]),
        output_text: tightenResult.text,
        tool_calls: null,
        input_tokens: tightenResult.input_tokens,
        output_tokens: tightenResult.output_tokens,
        thinking_tokens: 0,
        duration_ms: tightenDuration,
      });

      text = tightenResult.text;
      totalInput += tightenResult.input_tokens;
      totalOutput += tightenResult.output_tokens;
    }
  }

  return {
    final_draft: text.trim(),
    input_tokens: totalInput,
    output_tokens: totalOutput,
  };
}
