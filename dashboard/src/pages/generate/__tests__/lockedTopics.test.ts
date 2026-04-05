import { describe, it, expect, beforeEach } from "vitest";
import {
  LOCKED_KEY,
  getLockedTopics,
  saveLockedTopics,
  mergeLocked,
  toggleLockedTopic,
  isTopicLocked,
} from "../lockedTopics";
import type { DiscoveryTopic } from "../../../api/client";

function topic(label: string, overrides: Partial<DiscoveryTopic> = {}): DiscoveryTopic {
  return {
    label,
    summary: `${label} summary`,
    source_headline: `${label} headline`,
    source_url: `https://example.com/${label}`,
    category_tag: "AI",
    ...overrides,
  };
}

/** In-memory MinimalStorage implementation for testing without jsdom. */
function memStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    __dump: () => Object.fromEntries(data),
  };
}

describe("lockedTopics: pure helpers", () => {
  describe("mergeLocked", () => {
    it("puts locked topics first, then fresh ones not already locked", () => {
      const locked = [topic("A"), topic("B")];
      const fresh = [topic("C"), topic("D")];
      const merged = mergeLocked(locked, fresh);
      expect(merged.map((t) => t.label)).toEqual(["A", "B", "C", "D"]);
    });

    it("de-duplicates fresh topics already present in locked (by label)", () => {
      const locked = [topic("A"), topic("B")];
      const fresh = [topic("B"), topic("C"), topic("A")];
      const merged = mergeLocked(locked, fresh);
      expect(merged.map((t) => t.label)).toEqual(["A", "B", "C"]);
    });

    it("preserves fresh ordering for non-duplicates", () => {
      const locked = [topic("Z")];
      const fresh = [topic("A"), topic("B"), topic("C")];
      const merged = mergeLocked(locked, fresh);
      expect(merged.map((t) => t.label)).toEqual(["Z", "A", "B", "C"]);
    });

    it("returns fresh unchanged when nothing is locked", () => {
      const merged = mergeLocked([], [topic("A"), topic("B")]);
      expect(merged.map((t) => t.label)).toEqual(["A", "B"]);
    });

    it("uses the locked version when fresh has a topic with the same label", () => {
      // Locked version is authoritative — preserves user's summary/tag even if
      // the feed would have returned slightly different metadata.
      const lockedT = topic("Shared", { summary: "locked summary", category_tag: "Security" });
      const freshT = topic("Shared", { summary: "fresh summary", category_tag: "AI" });
      const merged = mergeLocked([lockedT], [freshT]);
      expect(merged).toHaveLength(1);
      expect(merged[0].summary).toBe("locked summary");
      expect(merged[0].category_tag).toBe("Security");
    });
  });

  describe("toggleLockedTopic", () => {
    it("adds a topic when absent", () => {
      const next = toggleLockedTopic([], topic("A"));
      expect(next.map((t) => t.label)).toEqual(["A"]);
    });

    it("removes a topic when already present (matched by label)", () => {
      const next = toggleLockedTopic([topic("A"), topic("B")], topic("A"));
      expect(next.map((t) => t.label)).toEqual(["B"]);
    });

    it("does not mutate the input array (returns a new reference)", () => {
      const before = [topic("A")];
      const after = toggleLockedTopic(before, topic("B"));
      expect(after).not.toBe(before);
      expect(before.map((t) => t.label)).toEqual(["A"]);
    });

    it("appends rather than reorders when toggling on", () => {
      const next = toggleLockedTopic([topic("A"), topic("B")], topic("C"));
      expect(next.map((t) => t.label)).toEqual(["A", "B", "C"]);
    });
  });

  describe("isTopicLocked", () => {
    it("returns true when the label matches", () => {
      expect(isTopicLocked([topic("A"), topic("B")], topic("A"))).toBe(true);
    });

    it("returns false when no label matches", () => {
      expect(isTopicLocked([topic("A")], topic("B"))).toBe(false);
    });

    it("matches on label only, even if other fields differ", () => {
      const a1 = topic("A", { source_url: "https://one.com" });
      const a2 = topic("A", { source_url: "https://two.com" });
      expect(isTopicLocked([a1], a2)).toBe(true);
    });

    it("returns false for an empty lock list", () => {
      expect(isTopicLocked([], topic("A"))).toBe(false);
    });
  });
});

describe("lockedTopics: storage", () => {
  let storage: ReturnType<typeof memStorage>;

  beforeEach(() => {
    storage = memStorage();
  });

  it("returns [] when nothing is stored", () => {
    expect(getLockedTopics(storage)).toEqual([]);
  });

  it("round-trips a list of topics through save + get", () => {
    const topics = [topic("A"), topic("B")];
    saveLockedTopics(topics, storage);
    const got = getLockedTopics(storage);
    expect(got).toHaveLength(2);
    expect(got.map((t) => t.label)).toEqual(["A", "B"]);
  });

  it("uses LOCKED_KEY as the storage key", () => {
    saveLockedTopics([topic("A")], storage);
    expect(storage.__dump()).toHaveProperty(LOCKED_KEY);
  });

  it("returns [] for unparseable stored JSON", () => {
    storage.setItem(LOCKED_KEY, "{{{ not json");
    expect(getLockedTopics(storage)).toEqual([]);
  });

  it("returns [] if stored value is not an array (defensive)", () => {
    storage.setItem(LOCKED_KEY, JSON.stringify({ notAnArray: true }));
    expect(getLockedTopics(storage)).toEqual([]);
  });

  it("returns [] when passed null storage (SSR / disabled)", () => {
    expect(getLockedTopics(null)).toEqual([]);
  });

  it("no-ops when saving with null storage (SSR / disabled)", () => {
    expect(() => saveLockedTopics([topic("A")], null)).not.toThrow();
  });

  it("overwrites previous content on save", () => {
    saveLockedTopics([topic("A"), topic("B")], storage);
    saveLockedTopics([topic("C")], storage);
    expect(getLockedTopics(storage).map((t) => t.label)).toEqual(["C"]);
  });
});

describe("lockedTopics: round-trip workflow", () => {
  it("simulates: lock → refresh (merge fresh) → unlock → persist", () => {
    const storage = memStorage();

    // User locks two topics from initial discovery
    let locked = toggleLockedTopic([], topic("AI Ethics"));
    locked = toggleLockedTopic(locked, topic("Zero Trust"));
    saveLockedTopics(locked, storage);

    // User hits "Find new topics" — fresh batch arrives
    const restored = getLockedTopics(storage);
    const fresh = [
      topic("Zero Trust"), // overlaps with locked
      topic("Supply Chain"),
      topic("LLM Evals"),
    ];
    const displayed = mergeLocked(restored, fresh);
    expect(displayed.map((t) => t.label)).toEqual([
      "AI Ethics",
      "Zero Trust",
      "Supply Chain",
      "LLM Evals",
    ]);

    // User unlocks AI Ethics
    locked = toggleLockedTopic(locked, topic("AI Ethics"));
    saveLockedTopics(locked, storage);

    // Another refresh
    const restored2 = getLockedTopics(storage);
    expect(restored2.map((t) => t.label)).toEqual(["Zero Trust"]);
    const displayed2 = mergeLocked(restored2, fresh);
    expect(displayed2.map((t) => t.label)).toEqual([
      "Zero Trust",
      "Supply Chain",
      "LLM Evals",
    ]);
  });
});
