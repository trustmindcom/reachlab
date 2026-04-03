import { describe, it, expect } from "vitest";
import {
  taxonomyPrompt,
  taggingPrompt,
  buildSystemPrompt,
  buildTopPerformerPrompt,
} from "../ai/prompts.js";

describe("taxonomyPrompt", () => {
  it("returns a string mentioning JSON", () => {
    const result = taxonomyPrompt("post summaries here");
    expect(result).toContain("post summaries here");
    expect(result.toLowerCase()).toContain("json");
  });
});

describe("taggingPrompt", () => {
  it("returns a string listing topic categories", () => {
    const taxonomy = [
      { name: "Leadership", description: "Posts about leadership" },
      { name: "Tech", description: "Posts about technology" },
    ];
    const result = taggingPrompt(taxonomy);
    expect(result).toContain("Leadership");
    expect(result).toContain("Tech");
  });
});

describe("buildSystemPrompt", () => {
  it("includes the knowledge base content", () => {
    const prompt = buildSystemPrompt("## Knowledge\ntest content", "No feedback yet.");
    expect(prompt).toContain("test content");
  });

  it("includes feedback history", () => {
    const prompt = buildSystemPrompt("knowledge", "User found X useful.");
    expect(prompt).toContain("User found X useful.");
  });

  it("includes language rules", () => {
    const prompt = buildSystemPrompt("knowledge", "feedback");
    expect(prompt).toContain("engagement rate");
    expect(prompt).toContain("Never reference posts by ID");
  });

  it("includes output schema instructions", () => {
    const prompt = buildSystemPrompt("knowledge", "feedback");
    expect(prompt).toContain("prompt_suggestions");
    expect(prompt).toContain("gaps");
  });
});

describe("buildTopPerformerPrompt", () => {
  it("includes post details", () => {
    const prompt = buildTopPerformerPrompt("Post about AI", "2026-03-01", 500, 20, "text", [
      { preview: "Other post", impressions: 300, er: 2.1, contentType: "text" },
    ]);
    expect(prompt).toContain("Post about AI");
    expect(prompt).toContain("500");
    expect(prompt).toContain("Other post");
    expect(prompt).toContain("Content type: text");
  });
});
