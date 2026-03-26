import { describe, it, expect, vi } from "vitest";
import { interpretStats } from "../ai/analyzer.js";
import type Anthropic from "@anthropic-ai/sdk";

// Minimal mock of AiLogger
const mockLogger = {
  log: vi.fn(),
};

const validOutput = {
  insights: [
    {
      category: "format",
      stable_key: "image_underperform",
      claim: "Image posts underperform text posts.",
      evidence: "3 image posts averaged 1.8% vs 2.9% for text.",
      confidence: "MODERATE",
      direction: "negative",
    },
  ],
  recommendations: [
    {
      key: "shift_to_text",
      type: "experiment",
      priority: 1,
      confidence: "MODERATE",
      headline: "Test more text-only posts",
      detail: "Text posts averaged 2.9% ER vs 1.8% for images.",
      action: "Publish one text-only post this week.",
    },
  ],
  overview: {
    summary_text: "Your text posts outperform images.",
    quick_insights: ["Text outperforms images"],
  },
  prompt_suggestions: {
    assessment: "working_well",
    reasoning: "Current prompt aligns with data.",
    suggestions: [],
  },
  gaps: [
    {
      type: "data_gap",
      stable_key: "missing_post_content",
      description: "48 posts lack full text.",
      impact: "Cannot analyze writing patterns.",
    },
  ],
};

// Mock client where every create call returns the same valid JSON
function makeMockClient(): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          { type: "thinking", thinking: "Some thinking..." },
          { type: "text", text: JSON.stringify(validOutput) },
        ],
        usage: { input_tokens: 100, output_tokens: 200 },
        stop_reason: "end_turn",
      }),
    },
  } as unknown as Anthropic;
}

describe("interpretStats", () => {
  it("calls Opus, GPT-5.4, and Sonnet reconciliation (3 total calls)", async () => {
    const client = makeMockClient();
    await interpretStats(client, "Stats report", "System prompt", mockLogger as any);
    // 2 parallel interpretation calls + 1 reconciliation
    expect(client.messages.create).toHaveBeenCalledTimes(3);
    // callModel calls use 180s timeout
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.stringContaining("/") }),
      expect.objectContaining({ timeout: 180_000, maxRetries: 2 })
    );
    // reconciliation call uses 120s timeout
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.any(String) }),
      expect.objectContaining({ timeout: 120_000, maxRetries: 2 })
    );
  });

  it("parses and returns structured JSON from reconciled output", async () => {
    const client = makeMockClient();
    const result = await interpretStats(client, "report", "system", mockLogger as any);
    expect(result).not.toBeNull();
    expect(result!.insights).toHaveLength(1);
    expect(result!.recommendations).toHaveLength(1);
    expect(result!.insights[0].confidence).toBe("MODERATE");
    expect(result!.gaps).toHaveLength(1);
    expect(result!.prompt_suggestions.assessment).toBe("working_well");
  });

  it("falls back to Opus if GPT-5.4 fails", async () => {
    let callCount = 0;
    const client = {
      messages: {
        create: vi.fn().mockImplementation((params: any) => {
          callCount++;
          // Second call (GPT-5.4) fails
          if (params.model === "openai/gpt-5.4") {
            return Promise.reject(new Error("GPT failed"));
          }
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify(validOutput) }],
            usage: { input_tokens: 100, output_tokens: 200 },
          });
        }),
      },
    } as unknown as Anthropic;

    const result = await interpretStats(client, "report", "system", mockLogger as any);
    // Should return Opus result directly (no reconciliation)
    expect(result).not.toBeNull();
    expect(result!.insights).toHaveLength(1);
  });

  it("returns null if both models fail", async () => {
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("all broken")),
      },
    } as unknown as Anthropic;

    const result = await interpretStats(client, "report", "system", mockLogger as any);
    expect(result).toBeNull();
  });
});
