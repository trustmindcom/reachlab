import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

describe("Generate early intent restore", () => {
  it("restores generation, author intent, research, stories, selection, and step one without legacy brainstorm state", async () => {
    const modulePath = "../../../dashboard/src/pages/Generate.js";
    const { restoreGeneration } = await import(modulePath);
    const result = await restoreGeneration({
      id: 41,
      persona_id: 1,
      author_intent: "Restore the controlling intent",
      research_id: 8,
      post_type: "general",
      selected_story_index: 0,
      drafts_json: null,
      selected_draft_indices: null,
      final_draft: null,
      quality_gate_json: null,
      combining_guidance: null,
      personal_connection: null,
      draft_length: null,
      prompt_snapshot: null,
      status: "draft",
      brainstorm_topic: "Historical topic must not map",
      brainstorm_angle: "Historical angle must not map",
      created_at: "2026-07-10T00:00:00Z",
      stories: [{ headline: "Evidence", summary: "Summary", source: "Source", age: "Today", tag: "tag", angles: [], is_stretch: false }],
      article_count: 1,
      source_count: 1,
    });

    expect(result?.step).toBe(1);
    expect(result?.state).toEqual(expect.objectContaining({
      generationId: 41,
      authorIntent: "Restore the controlling intent",
      researchId: 8,
      selectedStoryIndex: 0,
    }));
    expect(result?.state).not.toHaveProperty("brainstormTopic");
    expect(result?.state).not.toHaveProperty("selectedAngle");
    expect(result?.state.stories).toHaveLength(1);
  });
});
