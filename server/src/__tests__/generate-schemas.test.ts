import { describe, expect, it } from "vitest";
import { draftsBody, researchBody, startGenerationBody } from "../schemas/generate.js";

describe("intent-led generation request schemas", () => {
  it("accepts only a canonical author_intent for start", () => {
    expect(startGenerationBody.parse({ author_intent: "  exact intent  " })).toEqual({ author_intent: "exact intent" });
    expect(startGenerationBody.safeParse({ author_intent: " ", topic: "legacy" }).success).toBe(false);
  });

  it("uses generation_id authority for research and strips legacy topic", () => {
    expect(researchBody.parse({ generation_id: 1, topic: "replacement" })).toEqual({ generation_id: 1 });
    expect(researchBody.safeParse({ generation_id: 0 }).success).toBe(false);
  });

  it("uses generation_id with optional story selection for drafts", () => {
    expect(draftsBody.parse({ generation_id: 2, story_index: 0, topic: "legacy", angle: "legacy", research_id: 7 }))
      .toEqual({ generation_id: 2, story_index: 0 });
    expect(draftsBody.safeParse({ generation_id: 2, story_index: -1 }).success).toBe(false);
  });
});
