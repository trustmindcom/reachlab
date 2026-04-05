import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock feed-discoverer: discoverSources consumes discoverFeeds/discoverFeedsByGuessing
// to attach feed URLs to candidate sources.
vi.mock("../ai/feed-discoverer.js", () => ({
  discoverFeeds: vi.fn(),
  discoverFeedsByGuessing: vi.fn(),
}));

// Mock perplexity parser — only the content string matters for our tests.
vi.mock("../ai/perplexity.js", () => ({
  parseSonarResponse: (json: any) => ({
    content: json?.choices?.[0]?.message?.content ?? "",
  }),
}));

import {
  buildDiscoveryQuery,
  parseSourcesJson,
  discoverSources,
  MIN_VIABLE_SOURCES,
} from "../ai/source-discoverer.js";
import { discoverFeeds, discoverFeedsByGuessing } from "../ai/feed-discoverer.js";

const mockedDiscoverFeeds = vi.mocked(discoverFeeds);
const mockedDiscoverFeedsByGuessing = vi.mocked(discoverFeedsByGuessing);

function sonarResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function sourcesJson(hosts: string[]): string {
  return JSON.stringify(
    hosts.map((h) => ({
      name: h,
      url: `https://${h}`,
      description: `${h} desc`,
    }))
  );
}

describe("parseSourcesJson", () => {
  it("extracts name/url/description and drops entries missing either", () => {
    const raw = JSON.stringify([
      { name: "Good", url: "https://good.com", description: "ok" },
      { name: "", url: "https://nameless.com" },
      { name: "NoUrl" },
      { name: "Fine", url: "https://fine.com" },
    ]);
    const out = parseSourcesJson(raw);
    expect(out.map((s) => s.name)).toEqual(["Good", "Fine"]);
  });

  it("tolerates surrounding prose around the JSON array", () => {
    const raw = `Here you go:\n[{"name":"A","url":"https://a.com","description":"d"}]\nThanks!`;
    const out = parseSourcesJson(raw);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://a.com");
  });

  it("returns [] on unparseable content", () => {
    expect(parseSourcesJson("not json")).toEqual([]);
    expect(parseSourcesJson("[not valid")).toEqual([]);
  });

  it("truncates oversized fields defensively", () => {
    const long = "x".repeat(1000);
    const raw = JSON.stringify([{ name: long, url: `https://a.com/${long}`, description: long }]);
    const [s] = parseSourcesJson(raw);
    expect(s.name.length).toBe(200);
    expect(s.url.length).toBe(500);
    expect(s.description.length).toBe(500);
  });
});

describe("buildDiscoveryQuery", () => {
  it("omits the exclude block when no domains provided", () => {
    const q = buildDiscoveryQuery("AI, security", []);
    expect(q).toContain("AI, security");
    expect(q).not.toContain("Do NOT suggest");
  });

  it("includes the exclude block when domains are provided", () => {
    const q = buildDiscoveryQuery("AI", ["a.com", "b.com"]);
    expect(q).toContain("Do NOT suggest any of these sites");
    expect(q).toContain("a.com");
    expect(q).toContain("b.com");
  });

  it("asks for weekly-publishing sources", () => {
    const q = buildDiscoveryQuery("AI", []);
    expect(q).toMatch(/AT LEAST WEEKLY/i);
  });
});

describe("discoverSources", () => {
  const originalEnv = process.env.TRUSTMIND_LLM_API_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TRUSTMIND_LLM_API_KEY = "test-key";
    mockedDiscoverFeeds.mockReset();
    mockedDiscoverFeedsByGuessing.mockReset();
    mockedDiscoverFeedsByGuessing.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env.TRUSTMIND_LLM_API_KEY = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("stops after the first round when viable-source target is met", async () => {
    // 10 sources, all with feeds → meets MIN_VIABLE_SOURCES=8 in one round
    const hosts = Array.from({ length: 10 }, (_, i) => `site${i}.com`);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(sonarResponse(sourcesJson(hosts)));

    mockedDiscoverFeeds.mockImplementation(async (url: string) => {
      const host = new URL(url).hostname;
      return [{ feed_url: `https://${host}/feed`, title: host, postsPer30Days: 5 }];
    });

    const result = await discoverSources(["AI"]);
    const viable = result.filter((s) => s.feed_url);
    expect(viable.length).toBeGreaterThanOrEqual(MIN_VIABLE_SOURCES);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("runs additional rounds with an exclude list until target met", async () => {
    // Round 1: only 3 viable. Round 2: 6 new viable → total 9 ≥ 8.
    const round1Hosts = ["a.com", "b.com", "c.com"]; // all viable
    const round2Hosts = ["d.com", "e.com", "f.com", "g.com", "h.com", "i.com"]; // all viable

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sonarResponse(sourcesJson(round1Hosts)))
      .mockResolvedValueOnce(sonarResponse(sourcesJson(round2Hosts)));
    globalThis.fetch = fetchMock;

    mockedDiscoverFeeds.mockImplementation(async (url: string) => {
      const host = new URL(url).hostname;
      return [{ feed_url: `https://${host}/feed`, title: host, postsPer30Days: 3 }];
    });

    const result = await discoverSources(["AI"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second Perplexity call must include round-1 hosts in the exclude block
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const secondPrompt: string = secondCallBody.messages[0].content;
    expect(secondPrompt).toContain("Do NOT suggest");
    expect(secondPrompt).toContain("a.com");
    expect(secondPrompt).toContain("b.com");
    expect(secondPrompt).toContain("c.com");

    const viable = result.filter((s) => s.feed_url);
    expect(viable.length).toBeGreaterThanOrEqual(MIN_VIABLE_SOURCES);
  });

  it("returns what it has when three rounds cannot reach the target", async () => {
    const r1 = ["a.com", "b.com"];
    const r2 = ["c.com"];
    const r3 = ["d.com"];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sonarResponse(sourcesJson(r1)))
      .mockResolvedValueOnce(sonarResponse(sourcesJson(r2)))
      .mockResolvedValueOnce(sonarResponse(sourcesJson(r3)));
    globalThis.fetch = fetchMock;

    mockedDiscoverFeeds.mockImplementation(async (url: string) => {
      const host = new URL(url).hostname;
      return [{ feed_url: `https://${host}/feed`, title: host, postsPer30Days: 2 }];
    });

    const result = await discoverSources(["AI"]);
    expect(fetchMock).toHaveBeenCalledTimes(3); // capped at MAX_DISCOVERY_ROUNDS
    expect(result.map((s) => new URL(s.url).hostname)).toEqual(
      expect.arrayContaining(["a.com", "b.com", "c.com", "d.com"])
    );
  });

  it("sorts viable sources first, then by postsPer30Days desc", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sonarResponse(sourcesJson(["low.com", "high.com", "none.com", "mid.com"]))
      );

    mockedDiscoverFeeds.mockImplementation(async (url: string) => {
      const host = new URL(url).hostname;
      if (host === "high.com") return [{ feed_url: "https://high.com/feed", title: "h", postsPer30Days: 20 }];
      if (host === "mid.com") return [{ feed_url: "https://mid.com/feed", title: "m", postsPer30Days: 8 }];
      if (host === "low.com") return [{ feed_url: "https://low.com/feed", title: "l", postsPer30Days: 2 }];
      return []; // none.com has no discoverable feed
    });

    const result = await discoverSources(["AI"]);
    const orderedHosts = result.map((s) => new URL(s.url).hostname);
    expect(orderedHosts[0]).toBe("high.com");
    expect(orderedHosts[1]).toBe("mid.com");
    expect(orderedHosts[2]).toBe("low.com");
    expect(orderedHosts[3]).toBe("none.com");
  });

  it("falls back to discoverFeedsByGuessing when discoverFeeds returns nothing", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(sonarResponse(sourcesJson(["a.com"])));

    mockedDiscoverFeeds.mockResolvedValue([]);
    mockedDiscoverFeedsByGuessing.mockResolvedValue([
      { feed_url: "https://a.com/rss", title: "A", postsPer30Days: 4 },
    ]);

    const result = await discoverSources(["AI"]);
    expect(mockedDiscoverFeedsByGuessing).toHaveBeenCalled();
    expect(result[0].feed_url).toBe("https://a.com/rss");
    expect(result[0].postsPer30Days).toBe(4);
  });

  it("deduplicates candidates across rounds by domain", async () => {
    // Round 1 returns a.com. Round 2 returns a.com again + b.com.
    // We should only ever see a.com once in results.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sonarResponse(sourcesJson(["a.com"])))
      .mockResolvedValueOnce(sonarResponse(sourcesJson(["a.com", "b.com"])))
      .mockResolvedValueOnce(sonarResponse("[]"));
    globalThis.fetch = fetchMock;

    mockedDiscoverFeeds.mockImplementation(async (url: string) => {
      const host = new URL(url).hostname;
      return [{ feed_url: `https://${host}/feed`, title: host, postsPer30Days: 3 }];
    });

    const result = await discoverSources(["AI"]);
    const hosts = result.map((s) => new URL(s.url).hostname);
    expect(hosts.filter((h) => h === "a.com")).toHaveLength(1);
    expect(hosts).toContain("b.com");
  });

  it("stops early when Perplexity returns no new candidates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sonarResponse(sourcesJson(["a.com"])))
      .mockResolvedValueOnce(sonarResponse("[]"));
    globalThis.fetch = fetchMock;

    mockedDiscoverFeeds.mockImplementation(async (url: string) => {
      const host = new URL(url).hostname;
      return [{ feed_url: `https://${host}/feed`, title: host, postsPer30Days: 3 }];
    });

    const result = await discoverSources(["AI"]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // second round returned empty → stop
    expect(result).toHaveLength(1);
  });
});
