import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────

export interface GenerationMessage {
  id: number;
  generation_id: number;
  role: string;
  content: string;
  draft_snapshot: string | null;
  quality_json: string | null;
  tool_blocks_json: string | null;
  created_at: string;
}

// ── Generation Messages (chat history) ───────────────────

export function insertGenerationMessage(
  db: Database.Database,
  data: {
    generation_id: number;
    role: string;
    content: string;
    draft_snapshot?: string;
    quality_json?: string;
    tool_blocks_json?: string;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO generation_messages (generation_id, role, content, draft_snapshot, quality_json, tool_blocks_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(data.generation_id, data.role, data.content, data.draft_snapshot ?? null, data.quality_json ?? null, data.tool_blocks_json ?? null);
  return Number(result.lastInsertRowid);
}

export function getGenerationMessages(
  db: Database.Database,
  generationId: number,
  limit: number = 20
): GenerationMessage[] {
  return db
    .prepare(
      `SELECT * FROM generation_messages WHERE generation_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(generationId, limit) as GenerationMessage[];
}
