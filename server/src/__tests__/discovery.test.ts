import { describe, it, expect } from "vitest";
import { buildClusteringPrompt, parseClusteringResponse } from "../ai/discovery.js";
import type { RssItem } from "../ai/rss-fetcher.js";

const mockItems: RssItem[] = [
  { title: "AI Agents Take Over SRE", link: "https://example.com/1", summary: "AI agents are replacing SREs", pubDate: new Date() },
  { title: "Zero Trust Adoption Stalls", link: "https://example.com/2", summary: "Zero trust is hard", pubDate: new Date() },
];

describe("buildClusteringPrompt", () => {
  it("includes all headlines", () => {
    const prompt = buildClusteringPrompt(mockItems);
    expect(prompt).toContain("AI Agents Take Over SRE");
    expect(prompt).toContain("Zero Trust Adoption Stalls");
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
