/**
 * Discovers relevant news sources for a list of topics using Perplexity search,
 * then attempts to find RSS feeds for each discovered source.
 */

import { parseSonarResponse } from "./perplexity.js";
import { discoverFeeds, discoverFeedsByGuessing } from "./feed-discoverer.js";

export interface DiscoveredSource {
  name: string;
  url: string;
  feed_url: string | null;
  description: string;
  postsPer30Days?: number;
}

/** Target number of viable (feed-bearing, high-frequency) sources to keep. */
export const MIN_VIABLE_SOURCES = 8;
/** Maximum Perplexity calls before giving up and returning what we have. */
const MAX_DISCOVERY_ROUNDS = 3;

/** Lightweight Sonar search without requiring AiLogger (no run context needed) */
async function searchSonar(prompt: string): Promise<string> {
  const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
  if (!apiKey) {
    throw new Error("TRUSTMIND_LLM_API_KEY is required for source discovery");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "perplexity/sonar-pro",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Sonar API error: ${response.status}`);
    }

    const json = await response.json();
    const result = parseSonarResponse(json);
    return result.content;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildDiscoveryQuery(topicStr: string, excludeUrls: string[]): string {
  const excludeBlock =
    excludeUrls.length > 0
      ? `\n\nDo NOT suggest any of these sites (already found): ${excludeUrls.join(", ")}.`
      : "";
  return `Find 10-15 high-quality blogs, newsletters, and news sources that publish AT LEAST WEEKLY about: ${topicStr}. For each, provide the name, URL, and a one-sentence description. Focus on individual expert blogs and niche publications with active recent posts, not generic news sites like CNN or BBC, and not abandoned/inactive blogs.${excludeBlock} Return as a JSON array with fields: name, url, description. Only return the JSON array, no other text.`;
}

export function parseSourcesJson(content: string): DiscoveredSource[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((s: any) => ({
        name: String(s.name || "").slice(0, 200),
        url: String(s.url || "").slice(0, 500),
        feed_url: null as string | null,
        description: String(s.description || "").slice(0, 500),
      }))
      .filter((s: DiscoveredSource) => s.name && s.url);
  } catch {
    return [];
  }
}

/** Attach validated feed_url and postsPer30Days to each source (in place). */
async function attachFeeds(sources: DiscoveredSource[]): Promise<void> {
  await Promise.allSettled(
    sources.map(async (source) => {
      try {
        let feeds = await discoverFeeds(source.url);
        if (feeds.length === 0) {
          feeds = await discoverFeedsByGuessing(source.url);
        }
        if (feeds.length > 0) {
          source.feed_url = feeds[0].feed_url;
          source.postsPer30Days = feeds[0].postsPer30Days;
        }
      } catch {
        // Feed discovery is best-effort
      }
    })
  );
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function discoverSources(topics: string[]): Promise<DiscoveredSource[]> {
  const topicStr = topics.slice(0, 10).join(", ");
  const seen = new Map<string, DiscoveredSource>(); // keyed by domain

  for (let round = 0; round < MAX_DISCOVERY_ROUNDS; round++) {
    const viableCount = [...seen.values()].filter((s) => s.feed_url).length;
    if (viableCount >= MIN_VIABLE_SOURCES) break;

    const excludeUrls = [...seen.values()].map((s) => domainOf(s.url));
    const query = buildDiscoveryQuery(topicStr, excludeUrls);

    let content: string;
    try {
      content = await searchSonar(query);
    } catch {
      break; // network/API failure — return what we have
    }

    const candidates = parseSourcesJson(content)
      // Drop anything we've already looked at (by domain)
      .filter((s) => !seen.has(domainOf(s.url)));
    if (candidates.length === 0) break;

    await attachFeeds(candidates);

    for (const s of candidates) {
      seen.set(domainOf(s.url), s);
    }
  }

  // Sort: viable sources (feed_url present) first, by frequency desc
  return [...seen.values()].sort((a, b) => {
    const aHas = a.feed_url ? 1 : 0;
    const bHas = b.feed_url ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return (b.postsPer30Days ?? 0) - (a.postsPer30Days ?? 0);
  });
}
