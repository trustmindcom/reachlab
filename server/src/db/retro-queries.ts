import type Database from "better-sqlite3";

// ── Retro helpers ───────────────────────────────────────

export function startRetro(db: Database.Database, generationId: number, publishedText: string): void {
  db.prepare(
    "UPDATE generations SET published_text = ?, retro_json = NULL, retro_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(publishedText, generationId);
}

export function completeRetro(db: Database.Database, generationId: number, retroJson: string): void {
  db.prepare(
    "UPDATE generations SET retro_json = ?, retro_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(retroJson, generationId);
}

export function isPostMatchedToGeneration(db: Database.Database, postId: string): boolean {
  const row = db.prepare("SELECT id FROM generations WHERE matched_post_id = ?").get(postId);
  return row !== undefined;
}

export function getRetroResult(
  db: Database.Database,
  generationId: number
): { published_text: string | null; retro_json: string | null; retro_at: string | null } | undefined {
  return db.prepare(
    "SELECT published_text, retro_json, retro_at FROM generations WHERE id = ?"
  ).get(generationId) as any;
}

export function getPendingRetros(db: Database.Database, personaId: number): Array<{
  id: number;
  final_draft: string;
  published_text: string;
  retro_json: string;
  retro_at: string;
  matched_post_id: string | null;
}> {
  return db
    .prepare(
      `SELECT id, final_draft, published_text, retro_json, retro_at, matched_post_id
       FROM generations
       WHERE persona_id = ?
         AND retro_json IS NOT NULL
         AND retro_at IS NOT NULL
         AND retro_applied_at IS NULL
       ORDER BY retro_at DESC
       LIMIT 10`
    )
    .all(personaId) as any[];
}

export function markRetroApplied(db: Database.Database, generationId: number): void {
  db.prepare(
    "UPDATE generations SET retro_applied_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(generationId);
}
