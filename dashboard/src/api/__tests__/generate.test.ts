import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("generateApi intent-led request contracts", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => "1" });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("starts a durable generation from author intent", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ generation_id: 42, author_intent: "Canonical stored intent" }),
    });
    const { generateApi } = await import("../generate");
    const result = await generateApi.startGeneration("Write from this intent");

    expect(fetchMock).toHaveBeenCalledWith("/api/generate/start?personaId=1", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ author_intent: "Write from this intent" }),
    }));
    expect(result).toEqual({ generation_id: 42, author_intent: "Canonical stored intent" });
    expectTypeOf(result).toEqualTypeOf<{ generation_id: number; author_intent: string }>();
  });

  it("does not expose the displaced brainstorm client", async () => {
    const { generateApi } = await import("../generate");

    expect(generateApi).not.toHaveProperty("brainstormAngles");
  });

  it("researches by generation id and keeps source context as evidence", async () => {
    const { generateApi } = await import("../generate");
    const sourceContext = {
      summary: "Evidence only",
      source_headline: "Anchor headline",
      source_url: "https://example.com/anchor",
    };
    await generateApi.generateResearch(17, ["Avoid this"], sourceContext);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/generate/research?personaId=1");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      generation_id: 17,
      avoid: ["Avoid this"],
      source_context: sourceContext,
    });
  });

  it("generates drafts from generation id with optional story selection", async () => {
    const { generateApi } = await import("../generate");
    await generateApi.generateDrafts(17, null, "My experience", "short");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/generate/drafts?personaId=1");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      generation_id: 17,
      personal_connection: "My experience",
      length: "short",
    });
  });

  it("revises from persisted selection without sending topic, angle, or draft bodies", async () => {
    const { generateApi } = await import("../generate");
    await generateApi.reviseDrafts(17, "Start from my intent again", "restart_from_intent");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/generate/revise-drafts?personaId=1");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      generation_id: 17,
      feedback: "Start from my intent again",
      mode: "restart_from_intent",
    });
  });

  it("surfaces the safe server error from a revision response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: "Revision provider is unavailable" }),
    });
    const { generateApi } = await import("../generate");

    await expect(
      generateApi.reviseDrafts(17, "Try another direction", "restart_from_intent"),
    ).rejects.toThrow("Revision provider is unavailable");
  });

  it.each([
    ["startGeneration", () => ({ error: "Start rejected safely" }), "Start rejected safely"],
    ["generateResearch", () => ({ detail: "Research unavailable safely" }), "Research unavailable safely"],
    ["generateDrafts", () => ({ message: "Drafting unavailable safely" }), "Drafting unavailable safely"],
  ])("surfaces a safe server error from %s", async (method, body, expected) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, json: async () => body() });
    const { generateApi } = await import("../generate");

    const request = method === "startGeneration"
      ? generateApi.startGeneration("Rejected intent")
      : method === "generateResearch"
        ? generateApi.generateResearch(17)
        : generateApi.generateDrafts(17, null);
    await expect(request).rejects.toThrow(expected);
  });

  it("falls back to HTTP status when draft error payload has no safe message", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ internal: "do not expose" }) });
    const { generateApi } = await import("../generate");

    await expect(generateApi.generateDrafts(17, null)).rejects.toThrow("API error: 503");
  });
});
