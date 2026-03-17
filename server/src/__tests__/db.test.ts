import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase, runMigrations } from "../db/index.js";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test.db");

describe("Database initialization", () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.unlinkSync(TEST_DB_PATH + "-wal");
      fs.unlinkSync(TEST_DB_PATH + "-shm");
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
});
