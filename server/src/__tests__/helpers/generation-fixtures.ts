import type Database from "better-sqlite3";

export function insertLegacyGenerationFixture(
  db: Database.Database,
  personaId: number,
  data: {
    research_id?: number | null;
    post_type: string;
    selected_story_index?: number | null;
    drafts_json?: string;
    prompt_snapshot?: string;
    personal_connection?: string;
    draft_length?: string;
  },
): number {
  const result = db.prepare(`
    INSERT INTO generations (
      persona_id, research_id, post_type, selected_story_index, drafts_json,
      prompt_snapshot, personal_connection, draft_length
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    personaId,
    data.research_id ?? null,
    data.post_type,
    data.selected_story_index ?? null,
    data.drafts_json ?? null,
    data.prompt_snapshot ?? null,
    data.personal_connection ?? null,
    data.draft_length ?? null,
  );
  return Number(result.lastInsertRowid);
}
