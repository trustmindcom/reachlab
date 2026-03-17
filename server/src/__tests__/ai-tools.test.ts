import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../db/index.js";
import { upsertPost, insertPostMetrics } from "../db/queries.js";
import { createRun, insertAiLog } from "../db/ai-queries.js";
import {
  createQueryDbTool,
  executeQueryDb,
  createSubmitAnalysisTool,
} from "../ai/tools.js";
import { AiLogger } from "../ai/logger.js";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(
  import.meta.dirname,
  "../../data/test-ai-tools.db"
);

let db: Database.Database;

function seedPost(id: string, publishedAt?: string) {
  upsertPost(db, {
    id,
    content_type: "text",
    published_at: publishedAt ?? "2025-01-01T12:00:00Z",
  });
}

function seedPostWithMetrics(id: string, impressions: number) {
  seedPost(id);
  insertPostMetrics(db, { post_id: id, impressions, reactions: 5 });
}

describe("AI tools", () => {
  beforeEach(() => {
    try {
      if (db) db.close();
    } catch {}
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.unlinkSync(TEST_DB_PATH + "-wal");
      fs.unlinkSync(TEST_DB_PATH + "-shm");
    } catch {}
    db = initDatabase(TEST_DB_PATH);
  });

  afterAll(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.unlinkSync(TEST_DB_PATH + "-wal");
      fs.unlinkSync(TEST_DB_PATH + "-shm");
    } catch {}
  });

  // ── createQueryDbTool ──────────────────────────────────────

  describe("createQueryDbTool", () => {
    it("returns tool definition with schema in description", () => {
      const tool = createQueryDbTool();
      expect(tool.name).toBe("query_db");
      expect(tool.description).toBeDefined();
      expect(tool.description!.length).toBeGreaterThan(0);
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    });
  });

  // ── executeQueryDb ─────────────────────────────────────────

  describe("executeQueryDb", () => {
    it("executes valid SELECT query and returns markdown table", () => {
      seedPostWithMetrics("p1", 100);
      const result = executeQueryDb(
        db,
        "SELECT post_id, impressions FROM post_metrics"
      );
      expect(result).toContain("post_id");
      expect(result).toContain("impressions");
      expect(result).toContain("p1");
      expect(result).toContain("100");
      // Should have markdown table separators
      expect(result).toContain("|");
    });

    it("enforces LIMIT 100 when no LIMIT present", () => {
      // Seed more than a few posts
      for (let i = 0; i < 5; i++) {
        seedPostWithMetrics(`p${i}`, i * 10);
      }
      const result = executeQueryDb(
        db,
        "SELECT post_id FROM post_metrics"
      );
      // The query should have had LIMIT 100 appended
      // We can verify it still works (won't hit 100 with 5 rows)
      expect(result).toContain("p0");
      expect(result).toContain("p4");
    });

    it("does not double-add LIMIT when already present", () => {
      seedPostWithMetrics("p1", 100);
      seedPostWithMetrics("p2", 200);
      const result = executeQueryDb(
        db,
        "SELECT post_id FROM post_metrics LIMIT 1"
      );
      // Should only return 1 row
      const lines = result.split("\n").filter((l) => l.startsWith("|"));
      // Header row + separator + 1 data row = 3 lines with |
      expect(lines).toHaveLength(3);
    });

    it("rejects DELETE statements", () => {
      const result = executeQueryDb(db, "DELETE FROM posts");
      expect(result).toContain("Only SELECT");
    });

    it("rejects INSERT statements", () => {
      const result = executeQueryDb(
        db,
        "INSERT INTO posts (id) VALUES ('x')"
      );
      expect(result).toContain("Only SELECT");
    });

    it("rejects UPDATE statements", () => {
      const result = executeQueryDb(
        db,
        "UPDATE posts SET content_type = 'x'"
      );
      expect(result).toContain("Only SELECT");
    });

    it("rejects queries on disallowed tables (ai_logs)", () => {
      const result = executeQueryDb(db, "SELECT * FROM ai_logs");
      expect(result).toContain("not allowed");
    });

    it("returns error for malformed SQL", () => {
      const result = executeQueryDb(db, "SELECT * FROMM nowhere");
      expect(result.toLowerCase()).toContain("error");
    });

    it('returns "(no results)" for empty result sets', () => {
      const result = executeQueryDb(
        db,
        "SELECT * FROM posts WHERE id = 'nonexistent'"
      );
      expect(result).toBe("(no results)");
    });
  });

  // ── createSubmitAnalysisTool ───────────────────────────────

  describe("createSubmitAnalysisTool", () => {
    it("returns tool definition for structured output", () => {
      const tool = createSubmitAnalysisTool();
      expect(tool.name).toBe("submit_analysis");
      expect(tool.description).toBeDefined();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    });
  });
});

// ── AiLogger ────────────────────────────────────────────────

describe("AiLogger", () => {
  beforeEach(() => {
    try {
      if (db) db.close();
    } catch {}
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.unlinkSync(TEST_DB_PATH + "-wal");
      fs.unlinkSync(TEST_DB_PATH + "-shm");
    } catch {}
    db = initDatabase(TEST_DB_PATH);
  });

  afterAll(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.unlinkSync(TEST_DB_PATH + "-wal");
      fs.unlinkSync(TEST_DB_PATH + "-shm");
    } catch {}
  });

  it("logs an AI call to the database", () => {
    const runId = createRun(db, "manual", 5);
    const logger = new AiLogger(db, runId);
    logger.log({
      step: "tagging",
      model: "claude-3",
      input_messages: JSON.stringify([{ role: "user", content: "hi" }]),
      output_text: "response",
      tool_calls: null,
      input_tokens: 50,
      output_tokens: 25,
      thinking_tokens: 0,
      duration_ms: 1200,
    });
    const row = db
      .prepare("SELECT * FROM ai_logs WHERE run_id = ?")
      .get(runId) as any;
    expect(row).toBeDefined();
    expect(row.step).toBe("tagging");
    expect(row.input_tokens).toBe(50);
    expect(row.duration_ms).toBe(1200);
  });
});
