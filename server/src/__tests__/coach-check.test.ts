import { describe, it, expect } from "vitest";
import { buildCoachCheckPrompt, parseCoachCheckResponse } from "../ai/coach-check.js";

describe("buildCoachCheckPrompt", () => {
  it("includes draft, rules, and insights in prompt", () => {
    const prompt = buildCoachCheckPrompt(
      "This is a draft about AI.",
      [{ id: 1, category: "voice_tone", rule_text: "Be direct", example_text: null, sort_order: 0, enabled: 1 }],
      [{ id: 1, title: "Test insight", prompt_text: "Use examples", evidence: null, status: "active", source_sync_id: null, created_at: "", updated_at: "", retired_at: null }]
    );
    expect(prompt).toContain("This is a draft about AI.");
    expect(prompt).toContain("Be direct");
    expect(prompt).toContain("Use examples");
    expect(prompt).toContain("voice_match");
    expect(prompt).toContain("expertise_needed");
  });
});

describe("parseCoachCheckResponse", () => {
  it("parses valid JSON response", () => {
    const json = JSON.stringify({
      draft: "Fixed draft text",
      expertise_needed: [{ area: "Framing", question: "Is this the right angle?" }],
      alignment: [{ dimension: "voice_match", summary: "Matches practitioner tone" }],
    });
    const result = parseCoachCheckResponse(json);
    expect(result.draft).toBe("Fixed draft text");
    expect(result.expertise_needed).toHaveLength(1);
    expect(result.alignment).toHaveLength(1);
  });

  it("handles markdown-wrapped JSON", () => {
    const text = "```json\n" + JSON.stringify({
      draft: "Draft",
      expertise_needed: [],
      alignment: [],
    }) + "\n```";
    const result = parseCoachCheckResponse(text);
    expect(result.draft).toBe("Draft");
  });

  it("returns original draft on parse failure", () => {
    const result = parseCoachCheckResponse("not json at all");
    expect(result.draft).toBe("");
    expect(result.expertise_needed).toEqual([]);
    expect(result.alignment).toEqual([]);
  });
});
