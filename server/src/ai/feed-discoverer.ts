/**
 * Auto-discovers RSS/Atom feed URLs from a website URL.
 * User pastes "krebsonsecurity.com" → we find the feed.
 */

import Parser from "rss-parser";

const DISCOVER_TIMEOUT_MS = 8000;
const VALIDATE_TIMEOUT_MS = 8000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/** Minimum posts in past 30 days for a feed to be considered viable. */
export const MIN_POSTS_PER_30_DAYS = 2;

export interface DiscoveredFeed {
  feed_url: string;
  title: string;
  postsPer30Days?: number;
}

export type FeedValidationResult =
  | {
      valid: true;
      itemCount: number;
      postsPer30Days: number;
      latestItemDate: Date | null;
    }
  | { valid: false; reason: string };

/**
 * Fetches a candidate feed URL and verifies it parses as RSS/Atom, has ≥1 item,
 * and publishes at least MIN_POSTS_PER_30_DAYS items in the past 30 days
 * (when items carry pubDates — feeds that omit pubDate on every item pass through).
 * Returns a structured result rather than throwing so callers can skip silently.
 */
export async function validateFeedUrl(url: string): Promise<FeedValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ReachLab/1.0 Feed Validator" },
      redirect: "follow",
    });
    if (!response.ok) {
      return { valid: false, reason: `HTTP ${response.status}` };
    }
    const xml = await response.text();
    let feed;
    try {
      const parser = new Parser();
      feed = await parser.parseString(xml);
    } catch {
      return { valid: false, reason: "Invalid XML" };
    }
    const items = feed.items ?? [];
    const itemCount = items.length;
    if (itemCount < 1) {
      return { valid: false, reason: "No items in feed" };
    }

    // Frequency check: measure posts in the past 30 days and reject feeds
    // below the threshold. Only enforce when at least one item has a parseable
    // pubDate; feeds that omit pubDate on every item are left alone (lenient
    // fallback, they pass with postsPer30Days=0).
    const now = Date.now();
    let latestItemDate: Date | null = null;
    let postsPer30Days = 0;
    let datedItemCount = 0;
    for (const item of items) {
      if (!item.pubDate) continue;
      const d = new Date(item.pubDate);
      if (Number.isNaN(d.getTime())) continue;
      datedItemCount++;
      if (!latestItemDate || d > latestItemDate) latestItemDate = d;
      if (now - d.getTime() <= THIRTY_DAYS_MS) postsPer30Days++;
    }
    if (datedItemCount > 0 && postsPer30Days < MIN_POSTS_PER_30_DAYS) {
      const ageDays = latestItemDate
        ? Math.floor((now - latestItemDate.getTime()) / (24 * 60 * 60 * 1000))
        : null;
      const reason =
        postsPer30Days === 0
          ? ageDays !== null
            ? `Feed is stale (latest post ${ageDays} days ago)`
            : "Feed is stale"
          : `Feed publishes too rarely (${postsPer30Days} post${postsPer30Days === 1 ? "" : "s"} in past 30 days)`;
      return { valid: false, reason };
    }

    return { valid: true, itemCount, postsPer30Days, latestItemDate };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { valid: false, reason: "Request timed out" };
    }
    return { valid: false, reason: "Fetch failed" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Try to find RSS/Atom feeds from a website URL */
export async function discoverFeeds(siteUrl: string): Promise<DiscoveredFeed[]> {
  const normalized = normalizeUrl(siteUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVER_TIMEOUT_MS);

  try {
    const response = await fetch(normalized, {
      signal: controller.signal,
      headers: { "User-Agent": "ReachLab/1.0 Feed Discoverer" },
      redirect: "follow",
    });
    if (!response.ok) return [];

    const contentType = response.headers.get("content-type") ?? "";

    // If the URL itself is a feed, return it directly (after validating)
    if (contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom")) {
      const text = await response.text();
      const title = extractFeedTitle(text);
      const candidate = { feed_url: normalized, title: title || hostnameLabel(normalized) };
      return await filterValidFeeds([candidate]);
    }

    // Otherwise parse HTML for <link> tags pointing to feeds
    const html = await response.text();
    const candidates = extractFeedLinks(html, normalized);
    return await filterValidFeeds(candidates);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Validate each candidate and drop any that fail. Silently skips failures. */
async function filterValidFeeds(candidates: DiscoveredFeed[]): Promise<DiscoveredFeed[]> {
  const results = await Promise.all(
    candidates.map(async (c): Promise<DiscoveredFeed | null> => {
      const v = await validateFeedUrl(c.feed_url);
      return v.valid ? { ...c, postsPer30Days: v.postsPer30Days } : null;
    })
  );
  return results.filter((c): c is DiscoveredFeed => c !== null);
}

/** Try common feed paths as fallback */
export async function discoverFeedsByGuessing(siteUrl: string): Promise<DiscoveredFeed[]> {
  const base = normalizeUrl(siteUrl).replace(/\/$/, "");
  const candidates = [
    `${base}/feed`,
    `${base}/feed/`,
    `${base}/rss`,
    `${base}/rss.xml`,
    `${base}/atom.xml`,
    `${base}/index.xml`,
    `${base}/feed.xml`,
  ];

  for (const url of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "ReachLab/1.0 Feed Discoverer" },
        redirect: "follow",
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      const text = await res.text();
      if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom") || text.trimStart().startsWith("<?xml") || text.trimStart().startsWith("<rss") || text.trimStart().startsWith("<feed")) {
        const validation = await validateFeedUrl(url);
        if (!validation.valid) continue;
        const title = extractFeedTitle(text);
        return [{ feed_url: url, title: title || hostnameLabel(url) }];
      }
    } catch {
      clearTimeout(timeout);
    }
  }
  return [];
}

// ── Helpers ────────────────────────────────────────────────

function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  return url;
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractFeedLinks(html: string, baseUrl: string): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  // Match <link> tags with rel="alternate" and type containing rss/atom
  const linkRegex = /<link[^>]*rel=["']alternate["'][^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    const typeMatch = tag.match(/type=["']([^"']+)["']/);
    if (!typeMatch) continue;
    const type = typeMatch[1].toLowerCase();
    if (!type.includes("rss") && !type.includes("atom") && !type.includes("xml")) continue;

    const hrefMatch = tag.match(/href=["']([^"']+)["']/);
    if (!hrefMatch) continue;

    let feedUrl = hrefMatch[1];
    // Resolve relative URLs
    if (feedUrl.startsWith("/")) {
      try {
        const base = new URL(baseUrl);
        feedUrl = `${base.origin}${feedUrl}`;
      } catch { continue; }
    }

    const titleMatch = tag.match(/title=["']([^"']+)["']/);
    feeds.push({
      feed_url: feedUrl,
      title: titleMatch?.[1] || hostnameLabel(baseUrl),
    });
  }
  return feeds;
}

function extractFeedTitle(xml: string): string {
  const titleMatch = xml.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch?.[1]?.trim() ?? "";
}
