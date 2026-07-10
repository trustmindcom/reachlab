import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase, runMigrations } from "../db/index.js";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test.db");
const MIGRATION_TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-migration-030.db");

describe("Database initialization", () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.unlinkSync(TEST_DB_PATH + "-wal");
      fs.unlinkSync(TEST_DB_PATH + "-shm");
    } catch {}
    try {
      fs.unlinkSync(MIGRATION_TEST_DB_PATH);
      fs.unlinkSync(MIGRATION_TEST_DB_PATH + "-wal");
      fs.unlinkSync(MIGRATION_TEST_DB_PATH + "-shm");
    } catch {}
  });

  it("creates database file and enables WAL mode", () => {
    const db = initDatabase(TEST_DB_PATH);
    const mode = db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");
    db.close();
  });

  it("creates all required tables", () => {
    const db = initDatabase(TEST_DB_PATH);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain("posts");
    expect(tables).toContain("post_metrics");
    expect(tables).toContain("follower_snapshots");
    expect(tables).toContain("profile_snapshots");
    expect(tables).toContain("scrape_log");
    expect(tables).toContain("schema_version");
    db.close();
  });

  it("creates indexes on post_metrics", () => {
    const db = initDatabase(TEST_DB_PATH);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='post_metrics'"
      )
      .all()
      .map((r: any) => r.name);

    expect(indexes).toContain("idx_post_metrics_post_id");
    expect(indexes).toContain("idx_post_metrics_scraped_at");
    db.close();
  });

  it("is idempotent — running init twice doesn't error", () => {
    const db1 = initDatabase(TEST_DB_PATH);
    db1.close();
    const db2 = initDatabase(TEST_DB_PATH);
    db2.close();
  });

  it("post_metrics table includes video columns", () => {
    const db = initDatabase(TEST_DB_PATH);
    const columns = db.prepare("PRAGMA table_info(post_metrics)").all() as any[];
    const colNames = columns.map((c: any) => c.name);

    expect(colNames).toContain("video_views");
    expect(colNames).toContain("watch_time_seconds");
    expect(colNames).toContain("avg_watch_time_seconds");
    db.close();
  });

  it("profile_snapshots table includes all_appearances column", () => {
    const db = initDatabase(TEST_DB_PATH);
    const columns = db
      .prepare("PRAGMA table_info(profile_snapshots)")
      .all() as any[];
    const colNames = columns.map((c: any) => c.name);

    expect(colNames).toContain("all_appearances");
    db.close();
  });

  it("creates all AI tables after migration", () => {
    const db = initDatabase(TEST_DB_PATH);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r: any) => r.name);

    const aiTables = [
      "ai_taxonomy",
      "ai_post_topics",
      "ai_tags",
      "ai_runs",
      "insights",
      "insight_lineage",
      "recommendations",
      "ai_overview",
      "ai_logs",
    ];

    for (const table of aiTables) {
      expect(tables, `missing table: ${table}`).toContain(table);
    }
    db.close();
  });

  it("posts table has full_text, hook_text, image_urls, image_local_paths columns", () => {
    const db = initDatabase(TEST_DB_PATH);
    const info = db.prepare("PRAGMA table_info(posts)").all() as { name: string }[];
    const names = info.map((c) => c.name);
    expect(names).toContain("full_text");
    expect(names).toContain("hook_text");
    expect(names).toContain("image_urls");
    expect(names).toContain("image_local_paths");
    db.close();
  });

  it("ai_image_tags table exists with correct columns", () => {
    const db = initDatabase(TEST_DB_PATH);
    const info = db.prepare("PRAGMA table_info(ai_image_tags)").all() as { name: string }[];
    const names = info.map((c) => c.name);
    expect(names).toContain("post_id");
    expect(names).toContain("image_index");
    expect(names).toContain("format");
    expect(names).toContain("people");
    expect(names).toContain("setting");
    expect(names).toContain("text_density");
    expect(names).toContain("energy");
    expect(names).toContain("tagged_at");
    expect(names).toContain("model");
    db.close();
  });

  it("creates AI table indexes", () => {
    const db = initDatabase(TEST_DB_PATH);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_ai%' OR name LIKE 'idx_insights%' OR name LIKE 'idx_recommendations%'"
      )
      .all()
      .map((r: any) => r.name);

    expect(indexes).toContain("idx_ai_tags_post_id");
    expect(indexes).toContain("idx_insights_run_id");
    expect(indexes).toContain("idx_insights_stable_key");
    expect(indexes).toContain("idx_recommendations_run_id");
    expect(indexes).toContain("idx_ai_logs_run_id");
    expect(indexes).toContain("idx_ai_post_topics_post_id");
    expect(indexes).toContain("idx_ai_post_topics_taxonomy_id");
    db.close();
  });

  it("migration 030 upgrades an existing generation with constrained research and linked AI runs", () => {
    const db = new Database(MIGRATION_TEST_DB_PATH);
    try {
      db.pragma("foreign_keys = ON");
      db.exec(fs.readFileSync(path.join(import.meta.dirname, "../db/schema.sql"), "utf-8"));

      const migrationsDir = path.join(import.meta.dirname, "../db/migrations");
      const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
      for (const file of migrationFiles.filter((file) => Number.parseInt(file, 10) <= 29)) {
        db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf-8"));
        db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(Number.parseInt(file, 10));
      }

      const generationId = Number(db.prepare(`
        INSERT INTO generations (persona_id, post_type, drafts_json, status)
        VALUES (1, 'general', '[]', 'draft')
      `).run().lastInsertRowid);

      const migration030 = migrationFiles.find((file) => file.startsWith("030-"));
      expect(migration030).toBeDefined();
      db.transaction(() => {
        db.exec(fs.readFileSync(path.join(migrationsDir, migration030!), "utf-8"));
        db.prepare("INSERT INTO schema_version (version) VALUES (30)").run();
      })();

      const generation = db
        .prepare("SELECT author_intent, drafts_json FROM generations WHERE id = ?")
        .get(generationId) as { author_intent: string | null; drafts_json: string };
      expect(generation).toEqual({ author_intent: null, drafts_json: "[]" });

      const researchColumns = db
        .prepare("PRAGMA table_info(generation_research)")
        .all()
        .map((column: any) => column.name);
      expect(researchColumns).toContain("search_scope");
      expect(researchColumns).toContain("recent_cutoff");
      expect(() => db.prepare(`
        INSERT INTO generation_research (persona_id, post_type, stories_json, search_scope)
        VALUES (1, 'general', '[]', 'invalid')
      `).run()).toThrow(/CHECK constraint failed/);

      const aiRunColumns = db
        .prepare("PRAGMA table_info(ai_runs)")
        .all()
        .map((column: any) => column.name);
      expect(aiRunColumns).toContain("generation_id");

      const generationForeignKey = (db.prepare("PRAGMA foreign_key_list(ai_runs)").all() as any[])
        .find((foreignKey) => foreignKey.from === "generation_id");
      expect(generationForeignKey).toMatchObject({
        table: "generations",
        to: "id",
        on_delete: "SET NULL",
      });

      const indexColumns = db
        .prepare("PRAGMA index_info('idx_ai_runs_generation')")
        .all()
        .map((column: any) => column.name);
      expect(indexColumns).toEqual(["generation_id", "id"]);

      const aiRunId = Number(db.prepare(`
        INSERT INTO ai_runs (persona_id, triggered_by, generation_id)
        VALUES (1, 'migration-test', ?)
      `).run(generationId).lastInsertRowid);
      db.prepare("DELETE FROM generations WHERE id = ?").run(generationId);
      expect(db.prepare("SELECT generation_id FROM ai_runs WHERE id = ?").get(aiRunId))
        .toEqual({ generation_id: null });
    } finally {
      db.close();
    }
  });
});
