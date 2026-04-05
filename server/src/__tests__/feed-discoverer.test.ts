import { describe, it, expect, vi, afterEach } from "vitest";
import { validateFeedUrl } from "../ai/feed-discoverer.js";

function rfc822(d: Date): string {
  return d.toUTCString();
}

const recent1 = rfc822(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
const recent2 = rfc822(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
const stale1 = rfc822(new Date(Date.now() - 400 * 24 * 60 * 60 * 1000));
const stale2 = rfc822(new Date(Date.now() - 500 * 24 * 60 * 60 * 1000));
const onePost = rfc822(new Date(Date.now() - 15 * 24 * 60 * 60 * 1000));

const VALID_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Sample Feed</title>
    <item>
      <title>Post 1</title>
      <link>https://example.com/post-1</link>
      <pubDate>${recent1}</pubDate>
    </item>
    <item>
      <title>Post 2</title>
      <link>https://example.com/post-2</link>
      <pubDate>${recent2}</pubDate>
    </item>
  </channel>
</rss>`;

const STALE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Abandoned Feed</title>
    <item>
      <title>Old Post 1</title>
      <link>https://example.com/post-1</link>
      <pubDate>${stale1}</pubDate>
    </item>
    <item>
      <title>Old Post 2</title>
      <link>https://example.com/post-2</link>
      <pubDate>${stale2}</pubDate>
    </item>
  </channel>
</rss>`;

const UNDATED_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>No Dates Feed</title>
    <item>
      <title>Post 1</title>
      <link>https://example.com/post-1</link>
    </item>
  </channel>
</rss>`;

const LOW_FREQ_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Rare Blog</title>
    <item>
      <title>Recent but only one</title>
      <link>https://example.com/post-1</link>
      <pubDate>${onePost}</pubDate>
    </item>
    <item>
      <title>Much older</title>
      <link>https://example.com/post-2</link>
      <pubDate>${stale1}</pubDate>
    </item>
  </channel>
</rss>`;

const EMPTY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
  </channel>
</rss>`;

const OEMBED_RESPONSE = JSON.stringify({
  version: "1.0",
  type: "rich",
  title: "Oembed response",
  html: "<iframe></iframe>",
});

function mockFetch(response: { ok: boolean; status?: number; body?: string }): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    text: () => Promise.resolve(response.body ?? ""),
    headers: new Headers(),
  });
}

describe("validateFeedUrl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns valid with itemCount for a real RSS feed", async () => {
    mockFetch({ ok: true, body: VALID_RSS });
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.itemCount).toBe(2);
    }
  });

  it("returns invalid with HTTP status on server error", async () => {
    mockFetch({ ok: false, status: 500 });
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("HTTP 500");
    }
  });

  it("returns invalid with HTTP 404 on not found", async () => {
    mockFetch({ ok: false, status: 404 });
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("HTTP 404");
    }
  });

  it("returns invalid when feed parses but has zero items", async () => {
    mockFetch({ ok: true, body: EMPTY_RSS });
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("No items in feed");
    }
  });

  it("returns invalid for oembed-style (non-RSS) 200 responses", async () => {
    mockFetch({ ok: true, body: OEMBED_RESPONSE });
    const result = await validateFeedUrl(
      "https://example.com/wp-json/oembed/1.0/embed?url=x"
    );
    expect(result.valid).toBe(false);
    // oembed JSON isn't XML so parser reports invalid XML
    if (!result.valid) {
      expect(result.reason).toBe("Invalid XML");
    }
  });

  it("returns invalid for non-XML body (parse error)", async () => {
    mockFetch({ ok: true, body: "<!doctype html><html><body>nope</body></html>" });
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("Invalid XML");
    }
  });

  it("returns invalid when fetch rejects (network error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network down"));
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("Fetch failed");
    }
  });

  it("returns invalid when every item is older than 90 days", async () => {
    mockFetch({ ok: true, body: STALE_RSS });
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/stale/i);
    }
  });

  it("accepts feeds whose items carry no pubDate (lenient fallback)", async () => {
    mockFetch({ ok: true, body: UNDATED_RSS });
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.itemCount).toBe(1);
      expect(result.postsPer30Days).toBe(0);
      expect(result.latestItemDate).toBeNull();
    }
  });

  it("reports postsPer30Days and latestItemDate for fresh feeds", async () => {
    mockFetch({ ok: true, body: VALID_RSS });
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.postsPer30Days).toBe(2);
      expect(result.latestItemDate).toBeInstanceOf(Date);
    }
  });

  it("rejects feeds below the frequency threshold", async () => {
    mockFetch({ ok: true, body: LOW_FREQ_RSS });
    const result = await validateFeedUrl("https://example.com/feed");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/too rarely|stale/i);
    }
  });
});
