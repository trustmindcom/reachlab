import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getPriorityLabel,
  getConfidenceLabel,
  formatCategory,
  formatTimeAgo,
  formatTimeUntil,
  fmtNum,
  deltaClass,
  deltaLabel,
} from "../components";

describe("getPriorityLabel", () => {
  it("maps string HIGH/MEDIUM/MED/LOW case-insensitively", () => {
    expect(getPriorityLabel("HIGH").label).toBe("HIGH");
    expect(getPriorityLabel("high").label).toBe("HIGH");
    expect(getPriorityLabel("MEDIUM").label).toBe("MED");
    expect(getPriorityLabel("MED").label).toBe("MED");
    expect(getPriorityLabel("LOW").label).toBe("LOW");
    expect(getPriorityLabel("anything-else").label).toBe("LOW");
  });

  it("maps numeric 1/2/3 to HIGH/MED/LOW", () => {
    expect(getPriorityLabel(1).label).toBe("HIGH");
    expect(getPriorityLabel(2).label).toBe("MED");
    expect(getPriorityLabel(3).label).toBe("LOW");
  });

  it("treats numbers <=1 as HIGH (including 0 and negatives)", () => {
    expect(getPriorityLabel(0).label).toBe("HIGH");
    expect(getPriorityLabel(-5).label).toBe("HIGH");
  });

  it("returns a CSS class string for each bucket", () => {
    expect(getPriorityLabel("HIGH").classes).toContain("negative");
    expect(getPriorityLabel("MED").classes).toContain("warning");
    expect(getPriorityLabel("LOW").classes).toContain("text-muted");
  });
});

describe("getConfidenceLabel", () => {
  it("maps string STRONG/MODERATE/WEAK case-insensitively", () => {
    expect(getConfidenceLabel("STRONG").label).toBe("Strong");
    expect(getConfidenceLabel("moderate").label).toBe("Moderate");
    expect(getConfidenceLabel("weak").label).toBe("Weak");
    expect(getConfidenceLabel("unknown").label).toBe("Weak");
  });

  it("maps numeric 0-1 thresholds", () => {
    expect(getConfidenceLabel(1.0).label).toBe("Strong");
    expect(getConfidenceLabel(0.8).label).toBe("Strong");
    expect(getConfidenceLabel(0.7).label).toBe("Moderate");
    expect(getConfidenceLabel(0.6).label).toBe("Moderate");
    expect(getConfidenceLabel(0.59).label).toBe("Weak");
    expect(getConfidenceLabel(0).label).toBe("Weak");
  });

  it("returns a dot color class for each bucket", () => {
    expect(getConfidenceLabel("STRONG").dotClass).toContain("positive");
    expect(getConfidenceLabel("MODERATE").dotClass).toContain("warning");
    expect(getConfidenceLabel("WEAK").dotClass).toContain("negative");
  });
});

describe("formatCategory", () => {
  it("replaces underscores with spaces", () => {
    expect(formatCategory("ai_engineering")).toBe("ai engineering");
    expect(formatCategory("trust_and_safety")).toBe("trust and safety");
  });

  it("returns input unchanged when no underscores present", () => {
    expect(formatCategory("strategy")).toBe("strategy");
    expect(formatCategory("")).toBe("");
  });

  it("replaces every underscore, not just the first", () => {
    expect(formatCategory("a_b_c_d")).toBe("a b c d");
  });
});

describe("formatTimeAgo", () => {
  const FIXED_NOW = new Date("2026-04-05T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for <1 minute', () => {
    expect(formatTimeAgo("2026-04-05T11:59:30Z")).toBe("just now");
    expect(formatTimeAgo("2026-04-05T12:00:00Z")).toBe("just now");
  });

  it("returns minutes for <1 hour", () => {
    expect(formatTimeAgo("2026-04-05T11:55:00Z")).toBe("5m ago");
    expect(formatTimeAgo("2026-04-05T11:01:00Z")).toBe("59m ago");
  });

  it("returns hours for <1 day", () => {
    expect(formatTimeAgo("2026-04-05T09:00:00Z")).toBe("3h ago");
    expect(formatTimeAgo("2026-04-04T13:00:00Z")).toBe("23h ago");
  });

  it("returns days for >=1 day", () => {
    expect(formatTimeAgo("2026-04-04T12:00:00Z")).toBe("1d ago");
    expect(formatTimeAgo("2026-03-29T12:00:00Z")).toBe("7d ago");
  });

  it("handles timestamps without a Z suffix by treating them as UTC", () => {
    // SQLite often emits "2026-04-05 09:00:00" (no Z, no T). The formatter
    // appends Z if missing — so it must be parsed as UTC, not local time.
    expect(formatTimeAgo("2026-04-05T09:00:00")).toBe("3h ago");
  });
});

describe("formatTimeUntil", () => {
  const FIXED_NOW = new Date("2026-04-05T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "soon" for past/now timestamps', () => {
    expect(formatTimeUntil("2026-04-05T11:00:00Z")).toBe("soon");
    expect(formatTimeUntil("2026-04-05T12:00:00Z")).toBe("soon");
  });

  it('returns "< 1h" for <1 hour in the future', () => {
    expect(formatTimeUntil("2026-04-05T12:30:00Z")).toBe("< 1h");
  });

  it('returns "in Xh" for <1 day in the future', () => {
    expect(formatTimeUntil("2026-04-05T15:00:00Z")).toBe("in 3h");
    expect(formatTimeUntil("2026-04-06T11:00:00Z")).toBe("in 23h");
  });

  it('returns "in Xd" for >=1 day in the future', () => {
    expect(formatTimeUntil("2026-04-06T12:00:00Z")).toBe("in 1d");
    expect(formatTimeUntil("2026-04-12T12:00:00Z")).toBe("in 7d");
  });
});

describe("fmtNum", () => {
  it('returns "--" for null/undefined', () => {
    expect(fmtNum(null)).toBe("--");
    expect(fmtNum(undefined)).toBe("--");
  });

  it("formats integers with grouping", () => {
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(1000)).toBe("1,000");
    expect(fmtNum(1234567)).toBe("1,234,567");
  });

  it("preserves negatives", () => {
    expect(fmtNum(-42)).toBe("-42");
    expect(fmtNum(-10000)).toBe("-10,000");
  });
});

describe("deltaClass", () => {
  it("returns muted when either value missing or previous is zero", () => {
    expect(deltaClass(null, 100)).toBe("text-text-muted");
    expect(deltaClass(100, null)).toBe("text-text-muted");
    expect(deltaClass(100, 0)).toBe("text-text-muted");
  });

  it("returns positive class when current is >5% above previous", () => {
    expect(deltaClass(110, 100)).toBe("text-positive");
    expect(deltaClass(200, 100)).toBe("text-positive");
  });

  it("returns negative class when current is >5% below previous", () => {
    expect(deltaClass(94, 100)).toBe("text-negative");
    expect(deltaClass(0, 100)).toBe("text-negative");
  });

  it("returns muted for changes within ±5%", () => {
    expect(deltaClass(105, 100)).toBe("text-text-muted");
    expect(deltaClass(100, 100)).toBe("text-text-muted");
    expect(deltaClass(95, 100)).toBe("text-text-muted");
  });

  it("uses absolute value of previous for negative baselines", () => {
    // previous=-100, current=-90: pct = ((-90 - -100) / 100) * 100 = +10%
    expect(deltaClass(-90, -100)).toBe("text-positive");
  });
});

describe("deltaLabel", () => {
  it("returns null when either value missing or previous is zero", () => {
    expect(deltaLabel(null, 100)).toBe(null);
    expect(deltaLabel(100, null)).toBe(null);
    expect(deltaLabel(100, 0)).toBe(null);
  });

  it("formats positive changes with a + sign", () => {
    expect(deltaLabel(110, 100)).toBe("+10.0%");
    expect(deltaLabel(150, 100)).toBe("+50.0%");
  });

  it("formats negative changes without a + sign", () => {
    expect(deltaLabel(90, 100)).toBe("-10.0%");
    expect(deltaLabel(50, 100)).toBe("-50.0%");
  });

  it("formats zero change as +0.0%", () => {
    expect(deltaLabel(100, 100)).toBe("+0.0%");
  });

  it("uses one decimal place", () => {
    expect(deltaLabel(101, 100)).toBe("+1.0%");
    expect(deltaLabel(1005, 1000)).toBe("+0.5%");
  });
});
