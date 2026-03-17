import { describe, it, expect } from "vitest";
import {
  median,
  iqr,
  cliffsDelta,
  computeER,
  getPostPreview,
  getLocalHour,
  getLocalDayName,
  pct,
} from "../ai/stats-report.js";

describe("median", () => {
  it("returns null for empty array", () => expect(median([])).toBeNull());
  it("single element", () => expect(median([5])).toBe(5));
  it("even length — average of two middle values", () => expect(median([1, 3])).toBe(2));
  it("odd length — returns middle", () => expect(median([1, 2, 9])).toBe(2));
  it("unsorted input", () => expect(median([9, 1, 5])).toBe(5));
});

describe("iqr", () => {
  it("returns null for fewer than 4 values", () => {
    expect(iqr([1, 2, 3])).toBeNull();
  });
  it("returns a positive number for [1,2,3,4]", () => {
    const result = iqr([1, 2, 3, 4]);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });
});

describe("cliffsDelta", () => {
  it("d=0 and negligible for identical arrays", () => {
    const r = cliffsDelta([1, 2, 3], [1, 2, 3]);
    expect(r.d).toBe(0);
    expect(r.label).toBe("negligible");
  });
  it("d=1 and large when all x > all y", () => {
    const r = cliffsDelta([10, 11, 12], [1, 2, 3]);
    expect(r.d).toBe(1);
    expect(r.label).toBe("large");
  });
  it("d=-1 and large when all x < all y", () => {
    const r = cliffsDelta([1, 2, 3], [10, 11, 12]);
    expect(r.d).toBe(-1);
    expect(r.label).toBe("large");
  });
  it("negligible for |d| < 0.147", () => {
    const r = cliffsDelta([1, 2, 3, 4, 5], [1, 2, 3, 4, 6]);
    expect(r.label).toBe("negligible");
  });
  it("returns negligible for empty arrays", () => {
    const r = cliffsDelta([], [1, 2, 3]);
    expect(r.label).toBe("negligible");
  });
});

describe("computeER", () => {
  it("returns null when impressions is 0", () => {
    expect(computeER(10, 5, 3, 0)).toBeNull();
  });
  it("computes (reactions+comments+reposts)/impressions*100", () => {
    expect(computeER(10, 5, 5, 1000)).toBeCloseTo(2.0);
  });
  it("rounds correctly for 28 reactions, 5 comments, 2 reposts, 1000 impressions", () => {
    expect(computeER(28, 5, 2, 1000)).toBeCloseTo(3.5);
  });
});

describe("getPostPreview", () => {
  it("prefers hook_text over full_text", () => {
    expect(
      getPostPreview({ hook_text: "Hook text", full_text: "Full text", content_preview: "Preview" })
    ).toBe("Hook text");
  });
  it("falls back to full_text, truncated at 80 chars", () => {
    const longText = "a".repeat(100);
    const result = getPostPreview({ hook_text: null, full_text: longText, content_preview: null });
    expect(result).toBe("a".repeat(77) + "...");
  });
  it("falls back to content_preview", () => {
    expect(
      getPostPreview({ hook_text: null, full_text: null, content_preview: "Preview text" })
    ).toBe("Preview text");
  });
  it("returns 'Untitled post' when all null", () => {
    expect(getPostPreview({ hook_text: null, full_text: null, content_preview: null })).toBe(
      "Untitled post"
    );
  });
});

describe("getLocalHour", () => {
  it("converts 14:00 UTC to 9 in America/New_York (UTC-5 in January)", () => {
    const hour = getLocalHour("2026-01-15T14:00:00Z", "America/New_York");
    expect(hour).toBe(9);
  });
  it("converts 14:00 UTC to 14 in UTC", () => {
    expect(getLocalHour("2026-01-15T14:00:00Z", "UTC")).toBe(14);
  });
});

describe("getLocalDayName", () => {
  it("returns Thursday for 2026-01-15", () => {
    const day = getLocalDayName("2026-01-15T12:00:00Z", "UTC");
    expect(day).toBe("Thursday");
  });
});

describe("pct", () => {
  it("formats 2.3456 as '2.3%'", () => expect(pct(2.3456)).toBe("2.3%"));
  it("formats 0 as '0.0%'", () => expect(pct(0)).toBe("0.0%"));
});
