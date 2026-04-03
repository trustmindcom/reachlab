import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import { searchWithSonarPro, type SonarResult } from "./perplexity.js";
import { type Story } from "../db/generate-queries.js";

export interface ResearchResult {
  stories: Story[];
  article_count: number;
  source_count: number;
  sources_metadata: Array<{ name: string; url?: string }>;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ── Pure functions ─────────────────────────────────────────

export function buildSynthesisPrompt(
  topic: string,
  sonarContent: string,
  citations: string[],
  avoid?: string[]
): string {
  const citationList =
    citations.length > 0
      ? `\n\nSources (cite 1-2 per story):\n${citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")}`
      : "";

  const avoidSection =
    avoid && avoid.length > 0
      ? `\n\nAvoid overlapping with these previously covered angles:\n${avoid.map((a) => `- ${a}`).join("\n")}`
      : "";

  return `You are synthesizing web research into LinkedIn story cards.

Topic: ${topic}
Framing guidance: Frame each angle as a distinct practitioner perspective — different audience, different hook. Think: contrarian take, operator perspective, future implication.

Research content:
${sonarContent}${citationList}${avoidSection}

Create exactly 3 story card angles on this topic. Each angle should be distinct.

Return JSON (no markdown fences):
{
  "stories": [
    {
      "headline": "string — newsreader-style headline, max 12 words",
      "summary": "string — 2-3 sentences, practitioner-focused",
      "source": "string — publication or source name",
      "source_url": "string — URL if available, else empty string",
      "age": "string — e.g. 'This week', 'Emerging', 'Ongoing'",
      "tag": "string — topic category tag",
      "angles": ["string — angle 1", "string — angle 2"],
      "is_stretch": false
    }
  ]
}`;
}

export function parseSynthesizedStories(text: string): Story[] {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  // Try {stories: [...]} wrapper first
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as { stories?: Story[] } | Story;
      if ("stories" in parsed && Array.isArray((parsed as { stories: Story[] }).stories)) {
        return (parsed as { stories: Story[] }).stories;
      }
      // Single story object (no wrapper)
      if ("headline" in parsed) {
        return [parsed as Story];
      }
    } catch {
      // fall through to array attempt
    }
  }

  // Try bare array
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]) as Story[];
    } catch {
      return [];
    }
  }

  return [];
}

// ── Anchored synthesis prompt (discovery topics) ──────────

export function buildAnchoredSynthesisPrompt(
  topic: string,
  sourceContext: { summary: string; source_headline: string; source_url: string },
  avoid?: string[]
): string {
  const avoidSection =
    avoid && avoid.length > 0
      ? `\n\nAvoid overlapping with these previously covered angles:\n${avoid.map((a) => `- ${a}`).join("\n")}`
      : "";

  // Split topic on " — " to extract user's angle if present
  const dashIdx = topic.indexOf(" — ");
  const userAngle = dashIdx > 0 ? topic.slice(dashIdx + 3).trim() : "";

  return `You are creating 3 distinct LinkedIn story card angles based on a specific news story.

## Original Story
Headline: ${sourceContext.source_headline}
Summary: ${sourceContext.summary}
Source: ${sourceContext.source_url}

## User's Take
${userAngle || "No specific angle — explore different perspectives"}
${avoidSection}

Create exactly 3 story cards, each offering a DISTINCT take on this same story:
1. One that aligns with the user's perspective (or the most obvious practitioner angle)
2. One contrarian or unexpected angle
3. One "stretch" that connects this story to a broader theme

Each story card MUST be about THIS story, not a different article. The source and source_url for all 3 should reference the original story above.

Return JSON (no markdown fences):
{
  "stories": [
    {
      "headline": "string — newsreader-style headline, max 12 words",
      "summary": "string — 2-3 sentences, practitioner-focused",
      "source": "string — publication or source name",
      "source_url": "string — URL of the original story",
      "age": "string — e.g. 'This week', 'Emerging', 'Ongoing'",
      "tag": "string — topic category tag",
      "angles": ["string — angle 1", "string — angle 2"],
      "is_stretch": false
    }
  ]
}`;
}

// ── Orchestration ──────────────────────────────────────────

export async function researchStories(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger,
  topic: string,
  avoid?: string[],
  sourceContext?: { summary: string; source_headline: string; source_url: string }
): Promise<ResearchResult> {
  // When source context is provided (discovery topic click), skip Sonar and use anchored synthesis
  if (sourceContext) {
    const stories = await synthesizeAnchored(client, logger, topic, sourceContext, avoid);
    const finalStories = markStretch(stories.slice(0, 3));
    return {
      stories: finalStories,
      article_count: 1,
      source_count: 1,
      sources_metadata: [{ name: safeHostname(sourceContext.source_url), url: sourceContext.source_url }],
    };
  }

  // Manual topic input — existing Sonar flow
  const sonarResult = await searchWithSonarPro(topic, logger);
  const stories = await synthesizeTopic(client, logger, topic, sonarResult, avoid);
  const finalStories = markStretch(stories.slice(0, 3));
  return {
    stories: finalStories,
    article_count: sonarResult.citations.length,
    source_count: sonarResult.citations.length,
    sources_metadata: sonarResult.citations.map((url) => ({ name: safeHostname(url), url })),
  };
}

// ── Internal helpers ───────────────────────────────────────

async function synthesizeAnchored(
  client: Anthropic,
  logger: AiLogger,
  topic: string,
  sourceContext: { summary: string; source_headline: string; source_url: string },
  avoid?: string[]
): Promise<Story[]> {
  const prompt = buildAnchoredSynthesisPrompt(topic, sourceContext, avoid);
  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 2000,
    system: "You are a content researcher. Return only valid JSON.",
    messages: [{ role: "user", content: prompt }],
  }, { timeout: 45_000, maxRetries: 2 });
  const duration = Date.now() - start;
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  logger.log({
    step: "anchored_synthesis",
    model: MODELS.HAIKU,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });
  return parseSynthesizedStories(text);
}

async function synthesizeTopic(
  client: Anthropic,
  logger: AiLogger,
  topic: string,
  sonarResult: SonarResult,
  avoid?: string[]
): Promise<Story[]> {
  const synthPrompt = buildSynthesisPrompt(
    topic,
    sonarResult.content,
    sonarResult.citations,
    avoid
  );
  const synthStart = Date.now();
  const synthResponse = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 2000,
    system: "You are a content researcher. Return only valid JSON.",
    messages: [{ role: "user", content: synthPrompt }],
  }, { timeout: 45_000, maxRetries: 2 });
  const synthDuration = Date.now() - synthStart;
  const synthText =
    synthResponse.content[0].type === "text" ? synthResponse.content[0].text : "";
  logger.log({
    step: "synthesis",
    model: MODELS.HAIKU,
    input_messages: JSON.stringify([{ role: "user", content: synthPrompt }]),
    output_text: synthText,
    tool_calls: null,
    input_tokens: synthResponse.usage.input_tokens,
    output_tokens: synthResponse.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: synthDuration,
  });
  return parseSynthesizedStories(synthText);
}

function markStretch(stories: Story[]): Story[] {
  if (stories.length === 0) return stories;
  return stories.map((s, i) => ({ ...s, is_stretch: i === stories.length - 1 }));
}
