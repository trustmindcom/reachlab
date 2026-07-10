import { afterEach, describe, expect, it, vi } from "vitest";
import {
  researchIntent,
  searchPerplexity,
  type IntentSearchResult,
} from "../ai/intent-research.js";
import type { Story } from "../db/generate-queries.js";

const intent = "AI infrastructure decisions should start with operating constraints.";
const now = new Date("2026-07-10T12:00:00.000Z");

const recentResult: IntentSearchResult = {
  title: "Operators rethink AI infrastructure",
  url: "https://example.com/recent",
  snippet: "Teams are matching infrastructure choices to operating constraints.",
  date: "2026-06-24",
  last_updated: "2026-06-25",
};

const irrelevantResult: IntentSearchResult = {
  title: "A general technology roundup",
  url: "https://example.com/roundup",
  snippet: "Unrelated news from across the industry.",
  date: "2026-06-20",
  last_updated: "2026-06-20",
};

const olderRelevantResult: IntentSearchResult = {
  title: "The durable build-versus-buy question",
  url: "https://example.com/older",
  snippet: "An operating model for long-lived infrastructure decisions.",
  date: "2024-03-15",
  last_updated: "2024-04-01",
};

const story: Story = {
  headline: "Infrastructure Choices Encode Operating Constraints",
  summary: "Teams are treating build-versus-buy as an operating decision. The evidence shows why constraints matter more than fashion.",
  source: "Example",
  source_url: "https://example.com/recent",
  age: "This month",
  tag: "AI infrastructure",
  angles: ["Operator trade-offs"],
  is_stretch: false,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("researchIntent", () => {
  it("returns recent relevant results without all-time fallback", async () => {
    const search = vi.fn().mockResolvedValueOnce([recentResult]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([recentResult.url]);
    const synthesize = vi.fn().mockResolvedValueOnce([story]);

    const result = await researchIntent({ intent, now, search, selectRelevant, synthesize });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.searchScope).toBe("recent");
    expect(result.evidence).toEqual([recentResult]);
  });

  it("falls back exactly once after successful recent relevance is empty", async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([irrelevantResult])
      .mockResolvedValueOnce([olderRelevantResult]);
    const selectRelevant = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([olderRelevantResult.url]);
    const synthesizedStory = {
      ...story,
      source_url: olderRelevantResult.url,
    };
    const synthesize = vi.fn().mockResolvedValueOnce([synthesizedStory]);

    const result = await researchIntent({ intent, now, search, selectRelevant, synthesize });

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][0].after).toBe("05/10/2026");
    expect(search.mock.calls[1][0].after).toBeUndefined();
    expect(result.searchScope).toBe("all_time");
    expect(result.recentCutoff).toBe("05/10/2026");
    expect(result.evidence).toEqual([olderRelevantResult]);
    expect(result.stories).toEqual([synthesizedStory]);
    expect(selectRelevant.mock.calls[1][0]).toEqual({ intent, pages: [olderRelevantResult] });
    expect(synthesize).toHaveBeenCalledWith({ intent, pages: [olderRelevantResult] });
  });

  it("propagates recent provider rejection without all-time fallback", async () => {
    const search = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const selectRelevant = vi.fn();
    const synthesize = vi.fn();

    await expect(researchIntent({ intent, now, search, selectRelevant, synthesize }))
      .rejects.toThrow("provider unavailable");
    expect(search).toHaveBeenCalledTimes(1);
    expect(selectRelevant).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("throws a visible error for malformed or empty synthesis and does not fall back", async () => {
    const search = vi.fn().mockResolvedValueOnce([recentResult]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([recentResult.url]);
    const synthesize = vi.fn().mockResolvedValueOnce([]);

    await expect(researchIntent({ intent, now, search, selectRelevant, synthesize }))
      .rejects.toThrow("Synthesis returned invalid stories");
    expect(search).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["non-HTTP(S)", "file:///tmp/evidence"],
  ])("rejects typed synthesis with %s source_url", async (_label, sourceUrl) => {
    const search = vi.fn().mockResolvedValueOnce([recentResult]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([recentResult.url]);
    const synthesize = vi.fn().mockResolvedValueOnce([{ ...story, source_url: sourceUrl }]);

    await expect(researchIntent({ intent, now, search, selectRelevant, synthesize }))
      .rejects.toThrow("Synthesis returned invalid stories");
  });

  it("rejects a typed synthesis source_url that was not selected as evidence", async () => {
    const search = vi.fn().mockResolvedValueOnce([recentResult]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([recentResult.url]);
    const synthesize = vi.fn().mockResolvedValueOnce([{
      ...story,
      source_url: "https://example.com/unselected",
    }]);

    await expect(researchIntent({ intent, now, search, selectRelevant, synthesize }))
      .rejects.toThrow("Synthesis returned invalid stories");
  });

  it("returns successful empty all-time evidence when no result is relevant", async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([irrelevantResult])
      .mockResolvedValueOnce([]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([]);
    const synthesize = vi.fn();

    const result = await researchIntent({ intent, now, search, selectRelevant, synthesize });

    expect(search).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ stories: [], evidence: [], searchScope: "all_time" });
    expect(selectRelevant).toHaveBeenCalledTimes(1);
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("passes only selected pages to synthesis", async () => {
    const secondRecent = { ...recentResult, title: "Second result", url: "https://example.com/second" };
    const search = vi.fn().mockResolvedValueOnce([recentResult, secondRecent]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([secondRecent.url]);
    const synthesize = vi.fn().mockResolvedValueOnce([{
      ...story,
      source_url: secondRecent.url,
    }]);

    await researchIntent({ intent, now, search, selectRelevant, synthesize });

    expect(synthesize).toHaveBeenCalledWith({ intent, pages: [secondRecent] });
  });

  it("maps selected canonical IDs back to untouched provider evidence", async () => {
    const search = vi.fn().mockResolvedValueOnce([recentResult]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([recentResult.url]);
    const synthesize = vi.fn().mockResolvedValueOnce([story]);

    const result = await researchIntent({ intent, now, search, selectRelevant, synthesize });

    expect(result.evidence).toEqual([recentResult]);
    expect(result.evidence[0]).toBe(recentResult);
    expect(synthesize).toHaveBeenCalledWith({ intent, pages: [recentResult] });
  });

  it("does not let the relevance classifier mutate canonical evidence", async () => {
    const search = vi.fn().mockResolvedValueOnce([recentResult]);
    const selectRelevant = vi.fn().mockImplementation(async ({ pages }) => {
      pages[0].title = "Classifier-authored title";
      return [pages[0].url];
    });
    const synthesize = vi.fn().mockResolvedValueOnce([story]);

    const result = await researchIntent({ intent, now, search, selectRelevant, synthesize });

    expect(result.evidence[0].title).toBe("Operators rethink AI infrastructure");
    expect(synthesize).toHaveBeenCalledWith({ intent, pages: [recentResult] });
  });

  it("rejects unknown relevance IDs", async () => {
    const search = vi.fn().mockResolvedValueOnce([recentResult]);
    const selectRelevant = vi.fn().mockResolvedValueOnce(["https://example.com/unknown"]);

    await expect(researchIntent({ intent, now, search, selectRelevant, synthesize: vi.fn() }))
      .rejects.toThrow("Relevance selection returned an unknown ID");
  });

  it("rejects duplicate relevance IDs", async () => {
    const search = vi.fn().mockResolvedValueOnce([recentResult]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([recentResult.url, recentResult.url]);

    await expect(researchIntent({ intent, now, search, selectRelevant, synthesize: vi.fn() }))
      .rejects.toThrow("Relevance selection returned duplicate IDs");
  });

  it("does not send invalid-URL, undated, or pre-cutoff recent results to relevance selection", async () => {
    const invalidUrl = { ...recentResult, url: "not a URL" };
    const undated = { ...recentResult, url: "https://example.com/undated", date: null };
    const tooOld = { ...olderRelevantResult, url: "https://example.com/too-old" };
    const search = vi.fn()
      .mockResolvedValueOnce([invalidUrl, undated, tooOld, recentResult])
      .mockResolvedValueOnce([]);
    const selectRelevant = vi.fn().mockResolvedValue([]);
    const synthesize = vi.fn();

    await researchIntent({ intent, now, search, selectRelevant, synthesize });

    expect(selectRelevant.mock.calls[0][0]).toEqual({ intent, pages: [recentResult] });
  });

  it("rejects malformed recent provider dates before relevance selection or fallback", async () => {
    const malformedDate = { ...recentResult, date: "2026-02-30" };
    const search = vi.fn().mockResolvedValueOnce([malformedDate]);
    const selectRelevant = vi.fn();
    const synthesize = vi.fn();

    await expect(researchIntent({ intent, now, search, selectRelevant, synthesize }))
      .rejects.toThrow("Invalid Perplexity Search results");
    expect(search).toHaveBeenCalledTimes(1);
    expect(selectRelevant).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("rejects malformed all-time provider dates before relevance selection or synthesis", async () => {
    const malformedLastUpdated = { ...olderRelevantResult, last_updated: "last Tuesday" };
    const search = vi.fn()
      .mockResolvedValueOnce([irrelevantResult])
      .mockResolvedValueOnce([malformedLastUpdated]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([]);
    const synthesize = vi.fn();

    await expect(researchIntent({ intent, now, search, selectRelevant, synthesize }))
      .rejects.toThrow("Invalid Perplexity Search results");
    expect(search).toHaveBeenCalledTimes(2);
    expect(selectRelevant).toHaveBeenCalledTimes(1);
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("skips relevance selection when both searches have zero candidate pages", async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const selectRelevant = vi.fn();
    const synthesize = vi.fn();

    const result = await researchIntent({ intent, now, search, selectRelevant, synthesize });

    expect(result).toMatchObject({ stories: [], evidence: [], searchScope: "all_time" });
    expect(selectRelevant).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it.each([
    ["month end", new Date("2026-05-31T12:00:00.000Z"), "03/31/2026"],
    ["leap year", new Date("2024-04-30T12:00:00.000Z"), "02/29/2024"],
  ])("subtracts two calendar months across %s", async (_label, edgeNow, expectedCutoff) => {
    const search = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await researchIntent({
      intent,
      now: edgeNow,
      search,
      selectRelevant: vi.fn(),
      synthesize: vi.fn(),
    });

    expect(search.mock.calls[0][0].after).toBe(expectedCutoff);
  });

  it("rejects synthesized stories with unknown fields", async () => {
    const search = vi.fn().mockResolvedValueOnce([recentResult]);
    const selectRelevant = vi.fn().mockResolvedValueOnce([recentResult.url]);
    const synthesize = vi.fn().mockResolvedValueOnce([{ ...story, unexpected: "not allowed" }]);

    await expect(researchIntent({ intent, now, search, selectRelevant, synthesize }))
      .rejects.toThrow("Synthesis returned invalid stories");
  });

  it.each(["not a URL", "ftp://example.com/story"])(
    "rejects synthesized Story source_url %s",
    async (sourceUrl) => {
      const search = vi.fn().mockResolvedValueOnce([recentResult]);
      const selectRelevant = vi.fn().mockResolvedValueOnce([recentResult.url]);
      const synthesize = vi.fn().mockResolvedValueOnce([{ ...story, source_url: sourceUrl }]);

      await expect(researchIntent({ intent, now, search, selectRelevant, synthesize }))
        .rejects.toThrow("Synthesis returned invalid stories");
    },
  );
});

describe("searchPerplexity", () => {
  it("uses the official Search API request and validates structured results", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [recentResult],
      id: "search-id",
      server_time: "2026-07-10T12:00:00Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchPerplexity({ query: intent, after: "05/10/2026" }))
      .resolves.toEqual([recentResult]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.perplexity.ai/search", expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer pplx-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: intent, search_after_date_filter: "05/10/2026" }),
    }));
  });

  it("throws on malformed provider responses", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ title: "Missing required fields" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(searchPerplexity({ query: intent })).rejects.toThrow("Invalid Perplexity Search response");
  });

  it("normalizes documented optional provider dates", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{
        title: "Undated but otherwise valid",
        url: "https://example.com/undated-provider-result",
        snippet: "The Search API documents date fields as optional.",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(searchPerplexity({ query: intent })).resolves.toEqual([{
      title: "Undated but otherwise valid",
      url: "https://example.com/undated-provider-result",
      snippet: "The Search API documents date fields as optional.",
      date: null,
      last_updated: null,
    }]);
  });

  it("rejects malformed non-null provider dates", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ ...recentResult, last_updated: "not-an-iso-date" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(searchPerplexity({ query: intent }))
      .rejects.toThrow("Invalid Perplexity Search response");
  });

  it("keeps the timeout active while a successful response body stalls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-test-key");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init: RequestInit) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    })));

    const pending = expect(searchPerplexity({ query: intent })).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
  });

  it("keeps the timeout active while an error response body stalls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-test-key");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init: RequestInit) => ({
      ok: false,
      status: 503,
      text: () => new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    })));

    const pending = expect(searchPerplexity({ query: intent })).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
  });
});
