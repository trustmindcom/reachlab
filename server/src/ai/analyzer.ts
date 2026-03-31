import type Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import type { AiLogger } from "./logger.js";
import { MODELS } from "./client.js";

// ── Output schema type ─────────────────────────────────────

export interface AnalysisOutputSchema {
  insights: Array<{
    category: string;
    stable_key: string;
    claim: string;
    evidence: string;
    confidence: string;
    direction: string;
  }>;
  recommendations: Array<{
    key: string;
    type: string;
    priority: number;
    confidence: string;
    headline: string;
    detail: string;
    action: string;
  }>;
  overview: {
    summary_text: string;
    quick_insights: string[];
  };
  prompt_suggestions: {
    assessment: "working_well" | "suggest_changes";
    reasoning: string;
    suggestions: Array<{
      current: string;
      suggested: string;
      evidence: string;
    }>;
  };
  gaps: Array<{
    type: "data_gap" | "tool_gap" | "knowledge_gap";
    stable_key: string;
    description: string;
    impact: string;
  }>;
}

// ── Helpers ────────────────────────────────────────────────

function parseAnalysisJSON(text: string): AnalysisOutputSchema {
  try {
    return JSON.parse(jsonrepair(text));
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!match) {
      // Try extracting any JSON object from the response
      const objMatch = text.match(/\{[\s\S]*\}/);
      if (!objMatch) throw new Error("LLM response is not valid JSON");
      return JSON.parse(jsonrepair(objMatch[0]));
    }
    return JSON.parse(jsonrepair(match[1]!));
  }
}

/**
 * Call a single model for interpretation. Works with both Anthropic and
 * OpenAI-compatible models via OpenRouter.
 */
async function callModel(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  statsReport: string,
  logger: AiLogger,
  stepName: string,
): Promise<{ parsed: AnalysisOutputSchema; raw: string }> {
  const start = Date.now();

  // GPT models don't support the `thinking` param
  const isAnthropic = model.startsWith("anthropic/");
  const extraParams: Record<string, unknown> = {};
  if (isAnthropic) {
    extraParams.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: "user", content: statsReport }],
    ...extraParams,
  } as any, { timeout: 180_000, maxRetries: 2 });
  const duration = Date.now() - start;

  const textBlock = (response.content as any[])
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("");

  logger.log({
    step: stepName,
    model,
    input_messages: JSON.stringify([{ role: "user", content: "[stats report]" }]),
    output_text: textBlock.slice(0, 2000),
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  return { parsed: parseAnalysisJSON(textBlock), raw: textBlock };
}

// ── Reconciliation prompt ─────────────────────────────────

function buildReconciliationPrompt(
  opusRaw: string,
  gptRaw: string,
): string {
  return `You are reconciling two independent LinkedIn content analyses into a single cohesive output.

## Analysis A (Claude Opus)
${opusRaw}

## Analysis B (GPT-5.4)
${gptRaw}

## Instructions
Synthesize these two analyses into a single JSON output matching the EXACT schema below. Your job:

1. **Insights**: Keep insights that both models agree on (boost confidence). For insights only one model found, include them if the evidence is specific and verifiable — drop vague ones. Deduplicate by merging insights about the same pattern into one with the stronger evidence. Aim for 4-7 total.

2. **Recommendations**: Take the best from each. Prefer recommendations that are specific and actionable over generic advice. If both models recommend the same thing, merge into one with the better framing. If they contradict, go with the one backed by stronger evidence. Aim for 3-5 total.

3. **Overview**: Write a fresh summary that captures the most important points from both. Don't just concatenate — synthesize. Pick the 3 strongest quick insights across both.

4. **Prompt suggestions**: If either model suggests prompt changes, include the most evidence-backed suggestions. If both say "working_well", keep that.

5. **Gaps**: Union of both gap lists, deduplicated.

Respond with ONLY valid JSON (no markdown fences, no preamble):

{
  "insights": [{ "category": "string", "stable_key": "string", "claim": "string", "evidence": "string", "confidence": "STRONG | MODERATE | WEAK", "direction": "positive | negative | neutral" }],
  "recommendations": [{ "key": "string", "type": "quick_win | experiment | long_term | stop_doing", "priority": 1, "confidence": "STRONG | MODERATE | WEAK", "headline": "string", "detail": "string", "action": "string" }],
  "overview": { "summary_text": "string", "quick_insights": ["string"] },
  "prompt_suggestions": { "assessment": "working_well | suggest_changes", "reasoning": "string", "suggestions": [{ "current": "string", "suggested": "string", "evidence": "string" }] },
  "gaps": [{ "type": "data_gap | tool_gap | knowledge_gap", "stable_key": "string", "description": "string", "impact": "string" }]
}`;
}

// ── Main export ────────────────────────────────────────────

export async function interpretStats(
  client: Anthropic,
  statsReport: string,
  systemPrompt: string,
  logger: AiLogger,
): Promise<AnalysisOutputSchema | null> {
  // Step 1: Run Opus and GPT-5.4 in parallel
  const [opusResult, gptResult] = await Promise.allSettled([
    callModel(client, MODELS.OPUS, systemPrompt, statsReport, logger, "interpretation_opus"),
    callModel(client, MODELS.GPT54, systemPrompt, statsReport, logger, "interpretation_gpt54"),
  ]);

  const opusOk = opusResult.status === "fulfilled" ? opusResult.value : null;
  const gptOk = gptResult.status === "fulfilled" ? gptResult.value : null;

  // Log failures
  if (!opusOk) {
    const err = opusResult.status === "rejected" ? opusResult.reason : "unknown";
    logger.log({
      step: "interpretation_opus_failed",
      model: MODELS.OPUS,
      input_messages: "{}",
      output_text: err instanceof Error ? err.message : String(err),
      tool_calls: null,
      input_tokens: 0, output_tokens: 0, thinking_tokens: 0, duration_ms: 0,
    });
  }
  if (!gptOk) {
    const err = gptResult.status === "rejected" ? gptResult.reason : "unknown";
    logger.log({
      step: "interpretation_gpt54_failed",
      model: MODELS.GPT54,
      input_messages: "{}",
      output_text: err instanceof Error ? err.message : String(err),
      tool_calls: null,
      input_tokens: 0, output_tokens: 0, thinking_tokens: 0, duration_ms: 0,
    });
  }

  // If both failed, give up
  if (!opusOk && !gptOk) return null;

  // If only one succeeded, use it directly (no reconciliation needed)
  if (!opusOk) return gptOk!.parsed;
  if (!gptOk) return opusOk.parsed;

  // Step 2: Reconcile with Sonnet
  try {
    const reconciliationPrompt = buildReconciliationPrompt(opusOk.raw, gptOk.raw);
    const start = Date.now();
    const response = await client.messages.create({
      model: MODELS.SONNET,
      max_tokens: 16000,
      thinking: { type: "enabled", budget_tokens: 8000 },
      messages: [{ role: "user", content: reconciliationPrompt }],
    } as any, { timeout: 120_000, maxRetries: 2 });
    const duration = Date.now() - start;

    const textBlock = (response.content as any[])
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("");

    logger.log({
      step: "reconciliation",
      model: MODELS.SONNET,
      input_messages: JSON.stringify([{ role: "user", content: "[reconciliation prompt]" }]),
      output_text: textBlock.slice(0, 2000),
      tool_calls: null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: 0,
      duration_ms: duration,
    });

    return parseAnalysisJSON(textBlock);
  } catch (err) {
    // If reconciliation fails, fall back to Opus result
    logger.log({
      step: "reconciliation_failed",
      model: MODELS.SONNET,
      input_messages: "{}",
      output_text: err instanceof Error ? err.message : String(err),
      tool_calls: null,
      input_tokens: 0, output_tokens: 0, thinking_tokens: 0, duration_ms: 0,
    });
    return opusOk.parsed;
  }
}
