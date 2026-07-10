import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import type { FastifyInstance } from "fastify";
import { initDatabase } from "../db/index.js";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(() => ({ messages: {} })),
  researchIntent: vi.fn(),
  researchStories: vi.fn(),
  synthesizeIntentPages: vi.fn(),
  generateDrafts: vi.fn(),
  reviseDrafts: vi.fn(),
}));

vi.mock("../ai/client.js", () => ({
  getClient: mocks.getClient,
  calculateCostCents: vi.fn(() => 0),
  MODELS: {
    HAIKU: "test/haiku",
    SONNET: "test/sonnet",
    OPUS: "test/opus",
    GPT54: "test/gpt",
    SONAR_PRO: "test/sonar",
  },
}));

vi.mock("../ai/intent-research.js", () => ({
  researchIntent: mocks.researchIntent,
  searchPerplexity: vi.fn(),
}));

vi.mock("../ai/researcher.js", () => ({
  researchStories: mocks.researchStories,
  selectRelevantIntentPages: vi.fn(),
  synthesizeIntentPages: mocks.synthesizeIntentPages,
}));

vi.mock("../ai/drafter.js", () => ({
  generateDrafts: mocks.generateDrafts,
  reviseDrafts: mocks.reviseDrafts,
  LENGTH_RANGES: {},
  LENGTH_INSTRUCTIONS: {},
}));

import { buildApp } from "../app.js";
import { getGeneration, insertResearch, startGeneration, updateGeneration } from "../db/generate-queries.js";
import { insertLegacyGenerationFixture } from "./helpers/generation-fixtures.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-generate-intent-routes.db");

let app: FastifyInstance;

function removeTestDatabase(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix); } catch {}
  }
}

beforeEach(async () => {
  removeTestDatabase();
  mocks.getClient.mockClear();
  mocks.researchIntent.mockReset();
  mocks.researchStories.mockReset();
  mocks.synthesizeIntentPages.mockReset();
  mocks.generateDrafts.mockReset();
  mocks.reviseDrafts.mockReset();
  app = buildApp(TEST_DB_PATH);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  removeTestDatabase();
});

describe("POST /api/generate/start", () => {
  it("stores the exact canonical trimmed author intent before constructing AI state", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/generate/start?personaId=1",
      payload: { author_intent: "  Build  vs. BUY?!\nKeep\tOptions Open.  " },
    });

    expect(response.statusCode, response.body).toBe(200);
    const startResult = response.json();
    const generationId = startResult.generation_id;
    expect(startResult).toEqual({
      generation_id: generationId,
      author_intent: "Build  vs. BUY?!\nKeep\tOptions Open.",
    });
    const db = initDatabase(TEST_DB_PATH);
    try {
      expect(getGeneration(db, generationId)?.author_intent)
        .toBe("Build  vs. BUY?!\nKeep\tOptions Open.");
      expect((db.prepare("SELECT COUNT(*) AS count FROM ai_runs").get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it("rejects blank author intent without constructing an AI client", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/generate/start?personaId=1",
      payload: { author_intent: " \n\t " },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/generate/research intent authority", () => {
  it("loads stored intent by generation_id and ignores a replacement topic", async () => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "The stored controlling intent");
    db.close();
    mocks.researchIntent.mockResolvedValue({
      stories: [], evidence: [], searchScope: "all_time", recentCutoff: "05/10/2026",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/generate/research?personaId=1",
      payload: { generation_id: generationId, topic: "Request body replacement" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.researchIntent).toHaveBeenCalledWith(expect.objectContaining({
      intent: "The stored controlling intent",
    }));
  });

  it("rejects cross-persona generation access before constructing the model client", async () => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "Persona-owned intent");
    db.close();

    const response = await app.inject({
      method: "POST",
      url: "/api/generate/research?personaId=2",
      payload: { generation_id: generationId },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it("preserves anchored source context while stored intent remains controlling", async () => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "Stored intent controls the anchored request");
    db.close();
    mocks.researchStories.mockResolvedValue({
      stories: [], article_count: 1, source_count: 1,
      sources_metadata: [{ name: "example.com", url: "https://example.com/source" }],
    });
    const sourceContext = {
      summary: "Ambient evidence summary",
      source_headline: "Ambient evidence headline",
      source_url: "https://example.com/source",
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/generate/research?personaId=1",
      payload: { generation_id: generationId, source_context: sourceContext },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.researchStories).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      sourceContext.source_headline, undefined, sourceContext,
      "Stored intent controls the anchored request",
    );
    expect(mocks.researchIntent).not.toHaveBeenCalled();
  });

  it("threads avoid through typed synthesis without changing research orchestration", async () => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "Stored typed intent");
    db.close();
    mocks.synthesizeIntentPages.mockResolvedValue([]);
    mocks.researchIntent.mockImplementation(async ({ synthesize }: any) => {
      await synthesize({ intent: "Stored typed intent", pages: [] });
      return { stories: [], evidence: [], searchScope: "all_time", recentCutoff: "05/10/2026" };
    });
    const avoid = ["Repeated headline", "Repeated conclusion"];

    const response = await app.inject({
      method: "POST",
      url: "/api/generate/research?personaId=1",
      payload: { generation_id: generationId, avoid },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.synthesizeIntentPages).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      { intent: "Stored typed intent", pages: [], avoid },
    );
  });

  it("keeps generation intent and inserts no research row when the provider fails", async () => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "Keep me after provider failure");
    db.close();
    mocks.researchIntent.mockRejectedValue(new Error("provider unavailable"));

    const response = await app.inject({
      method: "POST",
      url: "/api/generate/research?personaId=1",
      payload: { generation_id: generationId },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "provider unavailable" });
    const checkDb = initDatabase(TEST_DB_PATH);
    try {
      expect(getGeneration(checkDb, generationId)?.author_intent).toBe("Keep me after provider failure");
      expect((checkDb.prepare("SELECT COUNT(*) AS count FROM generation_research").get() as { count: number }).count).toBe(0);
    } finally {
      checkDb.close();
    }
  });

  it("keeps generation intent and inserts no research row when synthesis fails", async () => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "Keep me after synthesis failure");
    db.close();
    mocks.researchIntent.mockRejectedValue(new Error("Synthesis returned invalid stories"));

    const response = await app.inject({
      method: "POST",
      url: "/api/generate/research?personaId=1",
      payload: { generation_id: generationId },
    });

    expect(response.statusCode).toBe(500);
    const checkDb = initDatabase(TEST_DB_PATH);
    try {
      expect(getGeneration(checkDb, generationId)?.author_intent).toBe("Keep me after synthesis failure");
      expect((checkDb.prepare("SELECT COUNT(*) AS count FROM generation_research").get() as { count: number }).count).toBe(0);
    } finally {
      checkDb.close();
    }
  });

  it("persists successful all-time zero evidence and updates the original generation", async () => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "An intent with no public evidence");
    db.close();
    mocks.researchIntent.mockResolvedValue({
      stories: [], evidence: [], searchScope: "all_time", recentCutoff: "05/10/2026",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/generate/research?personaId=1",
      payload: { generation_id: generationId },
    });

    expect(response.statusCode, response.body).toBe(200);
    const checkDb = initDatabase(TEST_DB_PATH);
    try {
      const research = checkDb.prepare("SELECT stories_json, sources_json, search_scope FROM generation_research").get() as any;
      expect(research).toEqual({ stories_json: "[]", sources_json: "[]", search_scope: "all_time" });
      expect(getGeneration(checkDb, generationId)?.research_id).toBe(response.json().research_id);
      expect((checkDb.prepare("SELECT COUNT(*) AS count FROM generations").get() as { count: number }).count).toBe(1);
    } finally {
      checkDb.close();
    }
  });
});

describe("POST /api/generate/drafts intent-led contexts", () => {
  const draftResult = {
    drafts: [{ type: "operator", hook: "Hook", body: "Body", closing: "Close", word_count: 3, structure_label: "Direct" }],
    prompt_snapshot: "snapshot", input_tokens: 1, output_tokens: 1,
  };

  beforeEach(() => mocks.generateDrafts.mockResolvedValue(draftResult));

  async function createGeneration(stories?: any[], selectedStoryIndex: number | null = null): Promise<number> {
    const db = initDatabase(TEST_DB_PATH);
    try {
      const generationId = startGeneration(db, 1, "Draft from this intent");
      if (stories !== undefined) {
        const researchId = insertResearch(db, 1, { post_type: "general", stories_json: JSON.stringify(stories) });
        updateGeneration(db, generationId, { research_id: researchId, selected_story_index: selectedStoryIndex });
      }
      return generationId;
    } finally {
      db.close();
    }
  }

  it.each([
    ["no research", undefined, undefined],
    ["zero stories", [], undefined],
    ["all stories unselected", [{ headline: "Evidence", summary: "Summary", source: "Source", age: "Today", tag: "tag", angles: [], is_stretch: false }], undefined],
    ["one selected story", [{ headline: "Evidence", summary: "Summary", source: "Source", age: "Today", tag: "tag", angles: [], is_stretch: false }], 0],
  ])("drafts with %s using the WritingContext boundary", async (_label, stories, storyIndex) => {
    const generationId = await createGeneration(stories as any[] | undefined);
    const response = await app.inject({
      method: "POST",
      url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: generationId, ...(storyIndex !== undefined ? { story_index: storyIndex } : {}) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().generation_id).toBe(generationId);
    expect(mocks.generateDrafts).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 1, expect.anything(),
      expect.objectContaining({ generationId, authorIntent: "Draft from this intent" }),
      undefined, undefined,
    );
  });

  it("rejects an invalid story index before constructing the model client", async () => {
    const generationId = await createGeneration([]);
    const response = await app.inject({
      method: "POST",
      url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: generationId, story_index: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.generateDrafts).not.toHaveBeenCalled();
  });

  it("updates the original generation ID and never inserts a second generation", async () => {
    const generationId = await createGeneration();
    const response = await app.inject({
      method: "POST",
      url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: generationId, length: "short" },
    });

    expect(response.statusCode).toBe(200);
    const db = initDatabase(TEST_DB_PATH);
    try {
      expect((db.prepare("SELECT COUNT(*) AS count FROM generations").get() as { count: number }).count).toBe(1);
      expect(JSON.parse(getGeneration(db, generationId)!.drafts_json!)).toEqual(draftResult.drafts);
    } finally {
      db.close();
    }
  });

  async function createRetryGeneration(options?: { malformedResearch?: boolean; missingIntent?: boolean }) {
    const db = initDatabase(TEST_DB_PATH);
    try {
      const story = { headline: "Evidence", summary: "Summary", source: "Source", age: "Today", tag: "tag", angles: [], is_stretch: false };
      const researchId = insertResearch(db, 1, {
        post_type: "general",
        stories_json: options?.malformedResearch ? "not JSON" : JSON.stringify([story, { ...story, headline: "Second" }]),
      });
      const generationId = options?.missingIntent
        ? insertLegacyGenerationFixture(db, 1, {
            post_type: "general", research_id: researchId, selected_story_index: 0, drafts_json: JSON.stringify([{ hook: "Old" }]),
          })
        : startGeneration(db, 1, "Preserve prior draft state on failure");
      if (!options?.missingIntent) {
        updateGeneration(db, generationId, {
          research_id: researchId,
          selected_story_index: 0,
          drafts_json: JSON.stringify([{ hook: "Old" }]),
          prompt_snapshot: "old snapshot",
        });
      }
      return generationId;
    } finally {
      db.close();
    }
  }

  function expectPriorDraftState(generationId: number) {
    const db = initDatabase(TEST_DB_PATH);
    try {
      const generation = getGeneration(db, generationId)!;
      expect(generation.selected_story_index).toBe(0);
      expect(generation.drafts_json).toBe(JSON.stringify([{ hook: "Old" }]));
    } finally {
      db.close();
    }
  }

  it("does not mutate selection or drafts when writing context is malformed", async () => {
    const generationId = await createRetryGeneration({ malformedResearch: true });

    const response = await app.inject({
      method: "POST", url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: generationId },
    });

    expect(response.statusCode).toBe(500);
    expectPriorDraftState(generationId);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it("does not mutate selection or drafts when stored intent is missing", async () => {
    const generationId = await createRetryGeneration({ missingIntent: true });

    const response = await app.inject({
      method: "POST", url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: generationId },
    });

    expect(response.statusCode).toBe(500);
    expectPriorDraftState(generationId);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it("does not mutate selection or drafts when client construction fails", async () => {
    const generationId = await createRetryGeneration();
    mocks.getClient.mockImplementationOnce(() => { throw new Error("client unavailable"); });

    const response = await app.inject({
      method: "POST", url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: generationId, story_index: 1 },
    });

    expect(response.statusCode).toBe(500);
    expectPriorDraftState(generationId);
  });

  it("does not mutate prior selection or drafts when a no-selection retry provider call fails", async () => {
    const generationId = await createRetryGeneration();
    mocks.generateDrafts.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await app.inject({
      method: "POST", url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: generationId },
    });

    expect(response.statusCode).toBe(500);
    expectPriorDraftState(generationId);
  });

  it("atomically updates requested selection and draft artifacts after provider success", async () => {
    const generationId = await createRetryGeneration();

    const response = await app.inject({
      method: "POST", url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: generationId, story_index: 1, length: "short" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.generateDrafts).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 1, expect.anything(),
      expect.objectContaining({ anchorEvidence: expect.objectContaining({ headline: "Second" }) }),
      undefined, "short",
    );
    const db = initDatabase(TEST_DB_PATH);
    try {
      const generation = getGeneration(db, generationId)!;
      expect(generation.selected_story_index).toBe(1);
      expect(generation.drafts_json).toBe(JSON.stringify(draftResult.drafts));
      expect(generation.prompt_snapshot).toBe("snapshot");
      expect(generation.draft_length).toBe("short");
    } finally {
      db.close();
    }
  });
});

describe("POST /api/generate/revise-drafts stored-intent authority", () => {
  const drafts = [
    { type: "contrarian", hook: "Rejected hook", body: "Rejected body", closing: "Rejected close", word_count: 6, structure_label: "Contrarian" },
    { type: "operator", hook: "Selected hook", body: "Selected body", closing: "Selected close", word_count: 6, structure_label: "Operator" },
  ];
  const revisedDrafts = [{ ...drafts[1], body: "Revised selected body" }];

  async function createRevisionGeneration(authorIntent: string | null = "Stored revision intent") {
    const db = initDatabase(TEST_DB_PATH);
    try {
      const generationId = authorIntent === null
        ? insertLegacyGenerationFixture(db, 1, { post_type: "general", drafts_json: JSON.stringify(drafts) })
        : startGeneration(db, 1, authorIntent);
      updateGeneration(db, generationId, {
        drafts_json: JSON.stringify(drafts),
        selected_draft_indices: JSON.stringify([1]),
        draft_length: "short",
      });
      return generationId;
    } finally {
      db.close();
    }
  }

  it("passes stored context and only persisted selected drafts while stripping replacement authority", async () => {
    const generationId = await createRevisionGeneration();
    mocks.reviseDrafts.mockResolvedValue({
      drafts: revisedDrafts, prompt_snapshot: "revision snapshot", input_tokens: 1, output_tokens: 1,
    });

    const response = await app.inject({
      method: "POST", url: "/api/generate/revise-drafts?personaId=1",
      payload: {
        generation_id: generationId,
        feedback: "Make it concrete",
        topic: "Caller replacement topic",
        angle: "Caller replacement angle",
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.reviseDrafts).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 1, expect.anything(),
      expect.objectContaining({ generationId, authorIntent: "Stored revision intent" }),
      [drafts[1]], "Make it concrete", "short",
    );
    const db = initDatabase(TEST_DB_PATH);
    try {
      expect(JSON.parse(getGeneration(db, generationId)!.drafts_json!)).toEqual(revisedDrafts);
      expect(getGeneration(db, generationId)!.selected_draft_indices).toBe("[]");
    } finally {
      db.close();
    }
  });

  it("rejects historical null-intent revision before client or model construction", async () => {
    const generationId = await createRevisionGeneration(null);
    mocks.getClient.mockClear();

    const response = await app.inject({
      method: "POST", url: "/api/generate/revise-drafts?personaId=1",
      payload: { generation_id: generationId, feedback: "Try again" },
    });

    expect(response.statusCode).toBe(500);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.reviseDrafts).not.toHaveBeenCalled();
  });

  it("keeps the selected-draft requirement without constructing the model client", async () => {
    const generationId = await createRevisionGeneration();
    const db = initDatabase(TEST_DB_PATH);
    updateGeneration(db, generationId, { selected_draft_indices: JSON.stringify([]) });
    db.close();
    mocks.getClient.mockClear();

    const response = await app.inject({
      method: "POST", url: "/api/generate/revise-drafts?personaId=1",
      payload: { generation_id: generationId, feedback: "Try again" },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.reviseDrafts).not.toHaveBeenCalled();
  });

  it("rejects cross-persona revision before loading context or constructing the model client", async () => {
    const generationId = await createRevisionGeneration();
    mocks.getClient.mockClear();

    const response = await app.inject({
      method: "POST", url: "/api/generate/revise-drafts?personaId=2",
      payload: { generation_id: generationId, feedback: "Try again" },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.reviseDrafts).not.toHaveBeenCalled();
  });

  it("keeps drafts and selection unchanged when revision fails", async () => {
    const generationId = await createRevisionGeneration();
    mocks.reviseDrafts.mockRejectedValue(new Error("provider unavailable"));

    const response = await app.inject({
      method: "POST", url: "/api/generate/revise-drafts?personaId=1",
      payload: { generation_id: generationId, feedback: "Try again" },
    });

    expect(response.statusCode).toBe(500);
    const db = initDatabase(TEST_DB_PATH);
    try {
      const generation = getGeneration(db, generationId)!;
      expect(generation.drafts_json).toBe(JSON.stringify(drafts));
      expect(generation.selected_draft_indices).toBe(JSON.stringify([1]));
    } finally {
      db.close();
    }
  });

  it("clears a successful multi-selection instead of retaining stale coordinates", async () => {
    const generationId = await createRevisionGeneration();
    const db = initDatabase(TEST_DB_PATH);
    updateGeneration(db, generationId, { selected_draft_indices: JSON.stringify([0, 1]) });
    db.close();
    mocks.reviseDrafts.mockResolvedValue({
      drafts: revisedDrafts, prompt_snapshot: "revision snapshot", input_tokens: 1, output_tokens: 1,
    });

    const response = await app.inject({
      method: "POST", url: "/api/generate/revise-drafts?personaId=1",
      payload: { generation_id: generationId, feedback: "Revise both" },
    });

    expect(response.statusCode, response.body).toBe(200);
    const checkDb = initDatabase(TEST_DB_PATH);
    try {
      expect(getGeneration(checkDb, generationId)!.selected_draft_indices).toBe("[]");
    } finally {
      checkDb.close();
    }
  });
});

describe("POST /api/generate/ghostwrite stored-intent authority", () => {
  it("rejects historical null-intent ghostwriting before client or model construction", async () => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = insertLegacyGenerationFixture(db, 1, { post_type: "general", drafts_json: "[]" });
    db.close();
    mocks.getClient.mockClear();

    const response = await app.inject({
      method: "POST", url: "/api/generate/ghostwrite?personaId=1",
      payload: { generation_id: generationId, message: "Write this", topic: "Replacement" },
    });

    expect(response.statusCode).toBe(500);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it.each([
    ["negative", [-1]],
    ["out of range", [2]],
    ["noninteger", [0.5]],
  ])("rejects %s persisted selection before client construction", async (_label, selectedIndices) => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "Stored ghostwriter intent");
    updateGeneration(db, generationId, {
      drafts_json: JSON.stringify([
        { type: "operator", hook: "Hook", body: "Body", closing: "Close", word_count: 3, structure_label: "Operator" },
      ]),
      selected_draft_indices: JSON.stringify(selectedIndices),
    });
    db.close();
    mocks.getClient.mockClear();

    const response = await app.inject({
      method: "POST", url: "/api/generate/ghostwrite?personaId=1",
      payload: { generation_id: generationId, message: "Write this" },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
});

describe("GET /api/generate/active early restore", () => {
  it("returns author intent, optional research, stories, and selected story before drafts", async () => {
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "Restore this intent before drafting");
    const story = { headline: "Evidence", summary: "Summary", source: "Source", age: "Today", tag: "tag", angles: [], is_stretch: false };
    const researchId = insertResearch(db, 1, { post_type: "general", stories_json: JSON.stringify([story]) });
    updateGeneration(db, generationId, { research_id: researchId, selected_story_index: 0 });
    db.close();

    const response = await app.inject({ method: "GET", url: "/api/generate/active?personaId=1" });

    expect(response.statusCode).toBe(200);
    expect(response.json().generation).toEqual(expect.objectContaining({
      id: generationId,
      author_intent: "Restore this intent before drafting",
      research_id: researchId,
      selected_story_index: 0,
      drafts_json: null,
      stories: [story],
    }));
  });
});
