import { describe, it, expect } from "vitest";
import { voteOnRecommendations } from "../ai/analyzer.js";

describe("self-consistency voting", () => {
  it("keeps recommendations appearing in 2+ of 3 runs", () => {
    const runs = [
      [{ key: "topic:hiring:opp", headline: "Short", detail: "A", type: "t", priority: "high", confidence: "strong", action: "x" }],
      [{ key: "topic:hiring:opp", headline: "Longer headline", detail: "More detailed", type: "t", priority: "high", confidence: "strong", action: "y" }],
      [{ key: "format:carousel:sug", headline: "Carousel", detail: "B", type: "f", priority: "med", confidence: "mod", action: "z" }],
    ];
    const result = voteOnRecommendations(runs);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("topic:hiring:opp");
    // Should pick the version with longest detail
    expect(result[0].detail).toBe("More detailed");
  });

  it("keeps all recommendations that appear in all 3 runs", () => {
    const rec = { key: "a", headline: "H", detail: "D", type: "t", priority: "h", confidence: "s", action: "a" };
    const runs = [[rec], [rec], [rec]];
    const result = voteOnRecommendations(runs);
    expect(result).toHaveLength(1);
  });

  it("drops recommendations appearing in only 1 run", () => {
    const runs = [
      [{ key: "unique1", headline: "H", detail: "D", type: "t", priority: "h", confidence: "s", action: "a" }],
      [{ key: "unique2", headline: "H", detail: "D", type: "t", priority: "h", confidence: "s", action: "a" }],
      [{ key: "unique3", headline: "H", detail: "D", type: "t", priority: "h", confidence: "s", action: "a" }],
    ];
    const result = voteOnRecommendations(runs);
    expect(result).toHaveLength(0);
  });

  it("handles empty runs array", () => {
    expect(voteOnRecommendations([])).toEqual([]);
  });
});
