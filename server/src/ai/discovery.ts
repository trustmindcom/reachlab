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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const TARGET_TOPICS = 12;

/**
 * Caps items per source domain to `maxPerDomain`, preferring the freshest
 * items within each domain. Ensures the LLM literally cannot over-concentrate
 * picks on a single dominant feed, since instruction-level diversity rules
 * are unreliably followed.
 */
export function balancePoolByDomain(items: RssItem[], maxPerDomain: number): RssItem[] {
  const byDomain = new Map<string, RssItem[]>();
  for (const item of items) {
    const d = extractDomain(item.link);
    let bucket = byDomain.get(d);
    if (!bucket) {
      bucket = [];
      byDomain.set(d, bucket);
    }
    bucket.push(item);
  }
  const out: RssItem[] = [];
  for (const bucket of byDomain.values()) {
    bucket.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    out.push(...bucket.slice(0, maxPerDomain));
  }
  return out;
}

/**
 * Post-hoc safety net. If the LLM skipped domains entirely (it does this
 * even with hard instructions), synthesize a basic topic from the freshest
 * pool item in each missing domain. Not as polished as an LLM summary but
 * better than silently dropping a domain.
 */
export function backfillMissingDomains(
  topics: DiscoveryTopic[],
  pool: RssItem[]
): DiscoveryTopic[] {
  const covered = new Set(topics.map((t) => extractDomain(t.source_url)));
  const byDomain = new Map<string, RssItem[]>();
  for (const item of pool) {
    const d = extractDomain(item.link);
    let bucket = byDomain.get(d);
    if (!bucket) {
      bucket = [];
      byDomain.set(d, bucket);
    }
    bucket.push(item);
  }
  const additions: DiscoveryTopic[] = [];
  for (const [domain, bucket] of byDomain) {
    if (covered.has(domain)) continue;
    bucket.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    const item = bucket[0];
    const summary =
      (item.summary && item.summary.trim().length >= 40
        ? item.summary.trim()
        : item.title).slice(0, 400);
    additions.push({
      label: item.title.slice(0, 80),
      summary,
      source_headline: item.title,
      source_url: item.link,
      category_tag: "News",
    });
  }
  return [...topics, ...additions];
}

/**
 * Post-hoc safety net. If the LLM ignored the per-domain cap (it sometimes
 * does), trim any domain that exceeded maxPerDomain while preserving order.
 */
export function enforceDiversity(
  topics: DiscoveryTopic[],
  maxPerDomain: number
): DiscoveryTopic[] {
  const perDomain = new Map<string, number>();
  const out: DiscoveryTopic[] = [];
  for (const t of topics) {
    const d = extractDomain(t.source_url);
    const c = perDomain.get(d) ?? 0;
    if (c >= maxPerDomain) continue;
    perDomain.set(d, c + 1);
    out.push(t);
  }
  return out;
}

export interface PoolShape {
  distinctDomains: number;
  maxPerDomain: number;
  targetTopics: number;
  minDomains: number;
}

export function computePoolShape(items: RssItem[]): PoolShape {
  const domains = new Set(items.map((i) => extractDomain(i.link)));
  const distinctDomains = Math.max(1, domains.size);
  // Loosen per-domain cap when the domain pool is narrow, so the target
  // is actually reachable: ceil(12 / domains), never below 2.
  const maxPerDomain = Math.max(2, Math.ceil(TARGET_TOPICS / distinctDomains));
  // Cap target by what the pool can actually supply.
  const targetTopics = Math.min(
    TARGET_TOPICS,
    maxPerDomain * distinctDomains,
    items.length
  );
  const minDomains = Math.min(3, distinctDomains);
  return { distinctDomains, maxPerDomain, targetTopics, minDomains };
}

export function buildClusteringPrompt(items: RssItem[], authorContext?: string, previousLabels?: string[]): string {
  const itemList = items
    .map((item, i) => `${i + 1}. ${item.title} — ${item.summary?.substring(0, 200) || ""} [${item.link}]`)
    .join("\n");

  const contextBlock = authorContext
    ? `\nAUTHOR CONTEXT — this creator's areas of expertise (use for framing, not for filtering):\n${authorContext}\n`
    : "";

  const avoidBlock = previousLabels && previousLabels.length > 0
    ? `\nAVOID THESE TOPICS — they were already suggested. Find DIFFERENT angles and topics:\n${previousLabels.map(l => `- ${l}`).join("\n")}\n`
    : "";

  const { maxPerDomain, targetTopics } = computePoolShape(items);
  const poolDomains = [...new Set(items.map((i) => extractDomain(i.link)))];
  const domainList = poolDomains.join(", ");

  return `You are a content researcher selecting trending topics for a LinkedIn content creator.
${contextBlock}${avoidBlock}
The items below come from RSS feeds the creator has deliberately subscribed to. Treat every item as topically relevant by default — do not re-filter for expertise. Your job is to pick the strongest, most post-worthy stories and give them a good framing.

RSS items (pre-selected from the author's chosen feeds):
${itemList}

Select ${targetTopics} distinct topics. For each topic:
- "label": a 3-5 word provocative title capturing an angle or debate
- "summary": 3-4 sentences explaining what happened, the key details, and why it matters. Give enough context that someone could write a LinkedIn post about it without reading the original article.
- "source_headline": the original article headline
- "source_url": the article URL from the list
- "category_tag": a short category label for color coding (e.g., "Security", "AI", "Dev Tools", "Trust & Safety", "Infrastructure", "Strategy")

DOMAIN COVERAGE (hard requirement):
- You MUST include at least one topic from EACH of these source domains: ${domainList}.
- Max ${maxPerDomain} topic${maxPerDomain === 1 ? "" : "s"} from any single source domain.
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
  const rawItems = await fetchAllFeeds(db, personaId);
  // Balance the pool per-domain *before* the LLM sees it. The per-domain cap
  // is derived from the raw domain count so the cap scales with how narrow
  // the pool is (ceil(12/domains), min 2).
  const rawShape = computePoolShape(rawItems);
  const rssItems = balancePoolByDomain(rawItems, rawShape.maxPerDomain);

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
  // Safety nets: (1) trim domains that slipped past the cap, then (2) backfill
  // any pool domain the LLM skipped entirely using its freshest item.
  const trimmed = enforceDiversity(result.topics, rawShape.maxPerDomain);
  const diversified = backfillMissingDomains(trimmed, rssItems);
  if (diversified.length === 0) {
    throw new Error("Topic discovery returned no topics");
  }
  return { topics: diversified };
}
