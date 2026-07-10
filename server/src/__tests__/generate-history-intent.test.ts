import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { initDatabase } from "../db/index.js";
import { startGeneration } from "../db/generate-queries.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-generate-history-intent.db");
let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(TEST_DB_PATH);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix); } catch {}
  }
});

describe("GET /api/generate/history intent headline", () => {
  it("uses author intent when no story is selected and brainstorm only for historical null-intent rows", async () => {
    const db = initDatabase(TEST_DB_PATH);
    try {
      startGeneration(db, 1, "The durable author-intent headline");
      db.prepare(`
        INSERT INTO generations (persona_id, post_type, brainstorm_topic, brainstorm_angle)
        VALUES (?, ?, ?, ?)
      `).run(1, "general", "Historical", "Historical brainstorm fallback");
    } finally {
      db.close();
    }

    const response = await app.inject({ method: "GET", url: "/api/generate/history?personaId=1" });
    expect(response.statusCode).toBe(200);
    const headlines = response.json().generations.map((generation: any) => generation.story_headline);
    expect(headlines).toContain("The durable author-intent headline");
    expect(headlines).toContain("Historical brainstorm fallback");
  });
});
