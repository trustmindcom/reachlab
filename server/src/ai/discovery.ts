import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import { fetchAllFeeds, type RssItem } from "./rss-fetcher.js";
import { getPersonaSetting } from "../db/ai-queries.js";

export interface DiscoveryTopic {
  label: string;
  summary: string;
  source_headline: string;
  source_url: string;
  category_tag: string;
}

export interface DiscoveryResult {
  topics: DiscoveryTopic[];
}

export function buildClusteringPrompt(items: RssItem[], authorContext?: string, previousLabels?: string[]): string {
  const itemList = items
    .map((item, i) => `${i + 1}. ${item.title} — ${item.summary?.substring(0, 200) || ""} [${item.link}]`)
    .join("\n");

  const contextBlock = authorContext
    ? `\nAUTHOR CONTEXT — this creator's areas of expertise:\n${authorContext}\n`
    : "";

  const avoidBlock = previousLabels && previousLabels.length > 0
    ? `\nAVOID THESE TOPICS — they were already suggested. Find DIFFERENT angles and topics:\n${previousLabels.map(l => `- ${l}`).join("\n")}\n`
    : "";

  return `You are a content researcher selecting trending topics for a LinkedIn content creator.
${contextBlock}${avoidBlock}
RSS items from the past week:
${itemList}

Filter to only items relevant to the author's expertise and interests described above. Discard general news, politics, and anything outside their domain.

IMPORTANT: The author's core expertise areas (from AUTHOR CONTEXT above) MUST each be represented. For example, if the author writes about security AND AI, include topics covering BOTH — don't let one area dominate.

Select exactly 12 distinct topics. For each topic:
- "label": a 3-5 word provocative title capturing an angle or debate
- "summary": 3-4 sentences explaining what happened, the key details, and why it matters. Give enough context that someone could write a LinkedIn post about it without reading the original article.
- "source_headline": the original article headline
- "source_url": the article URL from the list
- "category_tag": a short category label for color coding (e.g., "Security", "AI", "Dev Tools", "Trust & Safety", "Infrastructure", "Strategy")

DIVERSITY RULES:
- Max 2 topics from the same source domain. At least 3 distinct source domains.
- No two topics should cover the same story from different angles — each topic must be a distinct news item.
- No overlap: if two RSS items are about the same event, pick the better one.

Return JSON only (no markdown fences):
{
  "topics": [
    { "label": "3-5 word topic label", "summary": "1-2 sentence summary", "source_headline": "original headline", "source_url": "https://...", "category_tag": "Category" }
  ]
}`;
}

export function parseClusteringResponse(text: string): DiscoveryResult {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { topics: [] };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.topics)) {
      return { topics: [] };
    }
    return { topics: parsed.topics };
  } catch {
    return { topics: [] };
  }
}

export async function discoverTopics(
  client: Anthropic,
  db: Database.Database,
  personaId: number,
  logger: AiLogger,
  previousLabels?: string[]
): Promise<DiscoveryResult> {
  const rssItems = await fetchAllFeeds(db, personaId);

  // Build author context from taxonomy (what they've written about) + writing prompt
  const topics = db
    .prepare("SELECT name FROM ai_taxonomy ORDER BY name")
    .all() as { name: string }[];
  const writingPromptValue = getPersonaSetting(db, personaId, "writing_prompt");

  const contextParts: string[] = [];
  if (topics.length > 0) {
    // Group taxonomy topics to identify primary domains
    contextParts.push(`This creator's primary topics (from their post history): ${topics.map((t) => t.name).join(", ")}`);
    contextParts.push(`EVERY major theme above must be covered by at least one category in the output. Do not let a single theme dominate all categories.`);
  }
  if (writingPromptValue) {
    contextParts.push(`Creator's writing brief:\n${writingPromptValue}`);
  }
  const authorContext = contextParts.length > 0 ? contextParts.join("\n\n") : undefined;

  const prompt = buildClusteringPrompt(rssItems, authorContext, previousLabels);

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 2000,
    system: "You are a content researcher. Return only valid JSON.",
    messages: [{ role: "user", content: prompt }],
  }, { timeout: 45_000, maxRetries: 2 });

  const duration = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: "topic_discovery",
    model: MODELS.HAIKU,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  const result = parseClusteringResponse(text);
  if (result.topics.length === 0) {
    throw new Error("Topic discovery returned no topics");
  }
  return result;
}
