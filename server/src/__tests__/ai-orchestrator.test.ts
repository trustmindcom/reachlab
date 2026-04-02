import { describe, it, expect } from "vitest";
import { shouldRunPipeline } from "../ai/orchestrator.js";

describe("shouldRunPipeline", () => {
  it("returns false when post count < 5", () => {
    expect(shouldRunPipeline(3, null)).toEqual({ should: false, reason: "Need at least 5 posts with metrics" });
  });

  it("returns true when no previous run exists", () => {
    expect(shouldRunPipeline(5, null)).toEqual({ should: true });
  });

  it("returns false when fewer than 3 new posts since last run", () => {
    expect(shouldRunPipeline(12, { post_count: 11 })).toEqual({ should: false, reason: "Fewer than 3 new posts since last analysis" });
  });

  it("returns true when 3+ new posts since last run", () => {
    expect(shouldRunPipeline(15, { post_count: 11 })).toEqual({ should: true });
  });
});
