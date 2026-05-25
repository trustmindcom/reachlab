import { describe, it, expect } from "vitest";
import {
  backfillMissingDomains,
  balancePoolByDomain,
  buildClusteringPrompt,
  computePoolShape,
  enforceDiversity,
  parseClusteringResponse,
} from "../ai/discovery.js";
import type { RssItem } from "../ai/rss-fetcher.js";

const mockItems: RssItem[] = [
  { title: "AI Agents Take Over SRE", link: "https://example.com/1", summary: "AI agents are replacing SREs", pubDate: new Date() },
  { title: "Zero Trust Adoption Stalls", link: "https://example.com/2", summary: "Zero trust is hard", pubDate: new Date() },
];

function makeItems(domains: string[], perDomain: number): RssItem[] {
  const items: RssItem[] = [];
  for (const d of domains) {
    for (let i = 0; i < perDomain; i++) {
      items.push({
        title: `${d} post ${i}`,
        link: `https://${d}/post-${i}`,
        summary: "",
        pubDate: new Date(),
      });
    }
  }
  return items;
}

describe("buildClusteringPrompt", () => {
  it("includes all headlines", () => {
    const prompt = buildClusteringPrompt(mockItems);
    expect(prompt).toContain("AI Agents Take Over SRE");
    expect(prompt).toContain("Zero Trust Adoption Stalls");
  });

  it("adapts per-domain cap and target to a narrow domain pool", () => {
    const items = makeItems(["a.com", "b.com", "c.com", "d.com"], 5);
    const prompt = buildClusteringPrompt(items);
    // 4 domains → ceil(12/4) = 3 per domain, target = 12
    expect(prompt).toContain("Max 3 topics from any single source domain");
    expect(prompt).toContain("Select 12 distinct topics");
  });

  it("caps target to pool size when items are scarce", () => {
    const items = makeItems(["a.com", "b.com"], 2);
    const prompt = buildClusteringPrompt(items);
    // 2 domains, 4 items → target capped at 4
    expect(prompt).toContain("Select 4 distinct topics");
  });

  it("lists every pool domain under the domain-coverage requirement", () => {
    const items = makeItems(["alpha.com", "beta.com", "gamma.com"], 2);
    const prompt = buildClusteringPrompt(items);
    expect(prompt).toContain("DOMAIN COVERAGE");
    expect(prompt).toContain("alpha.com");
    expect(prompt).toContain("beta.com");
    expect(prompt).toContain("gamma.com");
  });

  it("does not tell the model to re-filter for expertise", () => {
    const prompt = buildClusteringPrompt(mockItems, "AI, security");
    // old prompt said "Filter to only items relevant..." — we now trust the
    // author's subscription as the relevance signal
    expect(prompt).not.toMatch(/Filter to only items relevant/);
    expect(prompt).toContain("Treat every item as topically relevant");
  });
});

describe("balancePoolByDomain", () => {
  it("caps each domain at maxPerDomain and keeps the freshest items", () => {
    const now = Date.now();
    const old = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const mid = new Date(now - 5 * 24 * 60 * 60 * 1000);
    const fresh = new Date(now - 1 * 24 * 60 * 60 * 1000);
    const items: RssItem[] = [
      { title: "A old", link: "https://a.com/1", summary: "", pubDate: old },
      { title: "A mid", link: "https://a.com/2", summary: "", pubDate: mid },
      { title: "A fresh", link: "https://a.com/3", summary: "", pubDate: fresh },
      { title: "B only", link: "https://b.com/1", summary: "", pubDate: mid },
    ];
    const out = balancePoolByDomain(items, 2);
    expect(out).toHaveLength(3); // 2 from a.com + 1 from b.com
    const aTitles = out.filter((i) => i.link.includes("a.com")).map((i) => i.title);
    expect(aTitles).toEqual(["A fresh", "A mid"]);
  });

  it("returns pool unchanged when nothing exceeds the cap", () => {
    const items: RssItem[] = [
      { title: "A", link: "https://a.com/1", summary: "", pubDate: new Date() },
      { title: "B", link: "https://b.com/1", summary: "", pubDate: new Date() },
    ];
    expect(balancePoolByDomain(items, 3)).toHaveLength(2);
  });
});

describe("backfillMissingDomains", () => {
  const now = Date.now();
  const d = (daysAgo: number) => new Date(now - daysAgo * 24 * 60 * 60 * 1000);

  it("adds a synthetic topic for each pool domain not represented in output", () => {
    const topics = [
      { label: "A1", summary: "", source_headline: "", source_url: "https://a.com/1", category_tag: "" },
    ];
    const pool: RssItem[] = [
      { title: "A post", link: "https://a.com/1", summary: "s", pubDate: d(1) },
      { title: "B fresh", link: "https://b.com/2", summary: "b summary here it is long enough to use", pubDate: d(1) },
      { title: "B old", link: "https://b.com/1", summary: "old", pubDate: d(10) },
      { title: "C item", link: "https://c.com/1", summary: "c summary here also long enough to use", pubDate: d(2) },
    ];
    const out = backfillMissingDomains(topics, pool);
    const hosts = out.map((t) => new URL(t.source_url).hostname);
    expect(hosts).toContain("a.com");
    expect(hosts).toContain("b.com");
    expect(hosts).toContain("c.com");
    expect(out).toHaveLength(3);
  });

  it("picks the freshest item when backfilling a domain", () => {
    const pool: RssItem[] = [
      { title: "old one", link: "https://b.com/1", summary: "xx", pubDate: d(15) },
      { title: "fresh one", link: "https://b.com/2", summary: "xx", pubDate: d(1) },
      { title: "mid one", link: "https://b.com/3", summary: "xx", pubDate: d(5) },
    ];
    const out = backfillMissingDomains([], pool);
    expect(out).toHaveLength(1);
    expect(out[0].source_url).toBe("https://b.com/2");
    expect(out[0].label).toBe("fresh one");
  });

  it("returns topics unchanged when every pool domain is covered", () => {
    const topics = [
      { label: "A", summary: "", source_headline: "", source_url: "https://a.com/1", category_tag: "" },
      { label: "B", summary: "", source_headline: "", source_url: "https://b.com/1", category_tag: "" },
    ];
    const pool: RssItem[] = [
      { title: "x", link: "https://a.com/x", summary: "", pubDate: d(1) },
      { title: "y", link: "https://b.com/y", summary: "", pubDate: d(1) },
    ];
    const out = backfillMissingDomains(topics, pool);
    expect(out).toEqual(topics);
  });

  it("falls back to title when summary is empty or too short", () => {
    const pool: RssItem[] = [
      { title: "Only title no summary here", link: "https://x.com/1", summary: "", pubDate: d(1) },
      { title: "Short-summary item", link: "https://y.com/1", summary: "tiny", pubDate: d(1) },
    ];
    const out = backfillMissingDomains([], pool);
    expect(out[0].summary).toBe("Only title no summary here");
    expect(out[1].summary).toBe("Short-summary item");
  });
});

describe("enforceDiversity", () => {
  it("trims any domain that exceeds the cap while preserving order", () => {
    const topics = [
      { label: "A1", summary: "", source_headline: "", source_url: "https://a.com/1", category_tag: "" },
      { label: "A2", summary: "", source_headline: "", source_url: "https://a.com/2", category_tag: "" },
      { label: "A3", summary: "", source_headline: "", source_url: "https://a.com/3", category_tag: "" },
      { label: "B1", summary: "", source_headline: "", source_url: "https://b.com/1", category_tag: "" },
      { label: "A4", summary: "", source_headline: "", source_url: "https://a.com/4", category_tag: "" },
    ];
    const out = enforceDiversity(topics, 2);
    expect(out.map((t) => t.label)).toEqual(["A1", "A2", "B1"]);
  });

  it("leaves well-balanced output untouched", () => {
    const topics = [
      { label: "A1", summary: "", source_headline: "", source_url: "https://a.com/1", category_tag: "" },
      { label: "B1", summary: "", source_headline: "", source_url: "https://b.com/1", category_tag: "" },
      { label: "C1", summary: "", source_headline: "", source_url: "https://c.com/1", category_tag: "" },
    ];
    expect(enforceDiversity(topics, 2)).toHaveLength(3);
  });
});

describe("computePoolShape", () => {
  it("uses max-2-per-domain for wide pools (6+ domains)", () => {
    const items = makeItems(["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"], 3);
    const shape = computePoolShape(items);
    expect(shape.distinctDomains).toBe(6);
    expect(shape.maxPerDomain).toBe(2);
    expect(shape.targetTopics).toBe(12);
    expect(shape.minDomains).toBe(3);
  });

  it("loosens to 6/domain when only 2 domains contribute", () => {
    const items = makeItems(["a.com", "b.com"], 10);
    const shape = computePoolShape(items);
    expect(shape.maxPerDomain).toBe(6);
    expect(shape.targetTopics).toBe(12);
    expect(shape.minDomains).toBe(2);
  });

  it("bounds target by items.length when pool is tiny", () => {
    const items = makeItems(["a.com"], 3);
    const shape = computePoolShape(items);
    expect(shape.distinctDomains).toBe(1);
    expect(shape.maxPerDomain).toBe(12);
    expect(shape.targetTopics).toBe(3);
    expect(shape.minDomains).toBe(1);
  });
});

describe("parseClusteringResponse", () => {
  it("parses valid topics", () => {
    const json = JSON.stringify({
      topics: [
        { label: "AI agents replacing SREs", summary: "AI agents are now handling SRE tasks.", source_headline: "AI Agents Take Over SRE", source_url: "https://example.com/1", category_tag: "AI" },
      ],
    });
    const result = parseClusteringResponse(json);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].label).toBe("AI agents replacing SREs");
  });

  it("returns empty topics on parse failure", () => {
    const result = parseClusteringResponse("not json");
    expect(result.topics).toEqual([]);
  });
});
