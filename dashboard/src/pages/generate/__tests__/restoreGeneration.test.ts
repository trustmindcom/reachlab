import { describe, expect, it, vi } from "vitest";
import type { GenHistoryDetail } from "../../../api/client";

vi.mock("../../../api/client", () => ({
  api: { generateChatHistory: vi.fn() },
}));
vi.mock("../SubTabBar", () => ({ default: () => null }));
vi.mock("../DiscoveryView", () => ({ default: () => null }));
vi.mock("../DraftVariations", () => ({ default: () => null }));
vi.mock("../GhostwriterChat", () => ({ default: () => null }));
vi.mock("../Rules", () => ({ default: () => null }));
vi.mock("../Sources", () => ({ default: () => null }));
vi.mock("../GenerationHistory", () => ({ default: () => null }));
vi.mock("../PostRetro", () => ({ default: () => null }));

describe("intent-led generation restore", () => {
  it("restores an early row at step one without historical brainstorm state", async () => {
    const { restoreGeneration } = await import("../../Generate");
    const detail = {
      id: 73,
      author_intent: "Restore this author intent",
      research_id: null,
      post_type: "general",
      selected_story_index: null,
      drafts_json: null,
      selected_draft_indices: null,
      final_draft: null,
      quality_gate_json: null,
      combining_guidance: null,
      personal_connection: null,
      draft_length: null,
      prompt_snapshot: null,
      status: "drafting",
      persona_id: 1,
      brainstorm_topic: "Legacy topic",
      brainstorm_angle: "Legacy angle",
      created_at: "2026-07-10T00:00:00Z",
      stories: [],
      article_count: 0,
      source_count: 0,
    } satisfies GenHistoryDetail;

    const restored = await restoreGeneration(detail);

    expect(restored?.step).toBe(1);
    expect(restored?.state).toMatchObject({
      generationId: 73,
      authorIntent: "Restore this author intent",
      researchId: null,
      stories: [],
      selectedStoryIndex: null,
    });
    expect(restored?.state).not.toHaveProperty("selectedTopic");
    expect(restored?.state).not.toHaveProperty("brainstormAngles");
    expect(restored?.state).not.toHaveProperty("brainstormTopic");
    expect(restored?.state).not.toHaveProperty("selectedAngle");
  });
});
