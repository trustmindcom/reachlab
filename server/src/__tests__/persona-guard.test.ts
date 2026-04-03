import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import { initDatabase } from "../db/index.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-persona-guard.db");

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(TEST_DB_PATH);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

async function createTestGeneration(personaId: number): Promise<number> {
  const db = initDatabase(TEST_DB_PATH);
  try {
    const { insertResearch, insertGeneration } = await import("../db/generate-queries.js");
    const researchId = insertResearch(db, personaId, {
      post_type: "general",
      stories_json: "[]",
    });
    const genId = insertGeneration(db, personaId, {
      research_id: researchId,
      post_type: "general",
      selected_story_index: 0,
      drafts_json: "[]",
    });
    return genId;
  } finally {
    db.close();
  }
}

async function createTestCoachSession(personaId: number): Promise<number> {
  const db = initDatabase(TEST_DB_PATH);
  try {
    const { createCoachSession } = await import("../db/coach-chat-queries.js");
    return createCoachSession(db, personaId);
  } finally {
    db.close();
  }
}

describe("getPersonaId validation", () => {
  it("returns 400 when no persona_id is provided", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/rules" });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/persona_id/i);
  });

  it("returns 400 for invalid persona_id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/rules?personaId=abc" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for zero persona_id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/rules?personaId=0" });
    expect(res.statusCode).toBe(400);
  });

  it("accepts personaId query param", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/rules?personaId=1" });
    expect(res.statusCode).toBe(200);
  });

  it("accepts persona_id query param (snake_case)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/rules?persona_id=1" });
    expect(res.statusCode).toBe(200);
  });

  it("accepts x-persona-id header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/generate/rules",
      headers: { "x-persona-id": "1" },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("persona guard on generation routes", () => {
  it("allows access to own generation", async () => {
    const genId = await createTestGeneration(1);
    const res = await app.inject({
      method: "GET",
      url: `/api/generate/history/${genId}?personaId=1`,
    });
    expect(res.statusCode).toBe(200);
  });

  it("blocks access to another persona's generation", async () => {
    const genId = await createTestGeneration(1);
    const res = await app.inject({
      method: "GET",
      url: `/api/generate/history/${genId}?personaId=2`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Not authorized");
  });

  it("returns 404 for non-existent generation (guard passes through)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/generate/history/999999?personaId=1",
    });
    expect(res.statusCode).toBe(404);
  });

  it("blocks discard on another persona's generation", async () => {
    const genId = await createTestGeneration(1);
    const res = await app.inject({
      method: "POST",
      url: `/api/generate/history/${genId}/discard?personaId=2`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks delete on another persona's generation", async () => {
    const genId = await createTestGeneration(1);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/generate/history/${genId}?personaId=2`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks draft save on another persona's generation", async () => {
    const genId = await createTestGeneration(1);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/generate/${genId}/draft?personaId=2`,
      payload: { draft: "sneaky" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks selection on another persona's generation", async () => {
    const genId = await createTestGeneration(1);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/generate/${genId}/selection?personaId=2`,
      payload: { selected_draft_indices: [0] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("coach session guard", () => {
  it("allows access to own session messages", async () => {
    const sessionId = await createTestCoachSession(1);
    const res = await app.inject({
      method: "GET",
      url: `/api/coach/chat/sessions/${sessionId}/messages?personaId=1`,
    });
    expect(res.statusCode).toBe(200);
  });

  it("blocks access to another persona's session messages", async () => {
    const sessionId = await createTestCoachSession(1);
    const res = await app.inject({
      method: "GET",
      url: `/api/coach/chat/sessions/${sessionId}/messages?personaId=2`,
    });
    expect(res.statusCode).toBe(403);
  });
});
