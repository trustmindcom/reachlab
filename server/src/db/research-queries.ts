import type Database from "better-sqlite3";

// ── Research ───────────────────────────────────────────────

export function insertResearch(
  db: Database.Database,
  personaId: number,
  data: { post_type: string; topic?: string; stories_json: string; sources_json?: string; article_count?: number; source_count?: number }
): number {
  const result = db
    .prepare(
      "INSERT INTO generation_research (persona_id, post_type, topic, stories_json, sources_json, article_count, source_count) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(personaId, data.post_type, data.topic ?? null, data.stories_json, data.sources_json ?? null, data.article_count ?? null, data.source_count ?? null);
  return Number(result.lastInsertRowid);
}

export function getResearch(
  db: Database.Database,
  id: number
): { id: number; post_type: string; stories_json: string; sources_json: string | null; article_count: number; source_count: number } | undefined {
  return db
    .prepare("SELECT * FROM generation_research WHERE id = ?")
    .get(id) as any;
}
