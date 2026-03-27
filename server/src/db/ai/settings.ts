import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────

export interface WritingPromptHistoryRow {
  id: number;
  prompt_text: string;
  source: string;
  suggestion_evidence: string | null;
  created_at: string;
}

// ── settings ───────────────────────────────────────────────

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function upsertSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(key, value);
}

export function deleteSetting(db: Database.Database, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// ── persona_settings ──────────────────────────────────────

const VALID_PERSONA_SETTING_KEYS = new Set([
  'writing_prompt',
  'auto_interpret_schedule',
  'auto_interpret_post_threshold',
  'last_discovery_labels',
]);

export function getPersonaSetting(db: Database.Database, personaId: number, key: string): string | null {
  const row = db.prepare(
    'SELECT value FROM persona_settings WHERE persona_id = ? AND key = ?'
  ).get(personaId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function upsertPersonaSetting(db: Database.Database, personaId: number, key: string, value: string): void {
  if (!VALID_PERSONA_SETTING_KEYS.has(key)) {
    throw new Error(`Invalid persona setting key: ${key}. Valid keys: ${[...VALID_PERSONA_SETTING_KEYS].join(', ')}`);
  }
  db.prepare(`
    INSERT INTO persona_settings (persona_id, key, value, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (persona_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(personaId, key, value);
}

// ── writing_prompt_history ─────────────────────────────────

export function saveWritingPromptHistory(
  db: Database.Database,
  personaId: number,
  input: { prompt_text: string; source: string; evidence: string | null }
): void {
  db.prepare(
    `INSERT INTO writing_prompt_history (persona_id, prompt_text, source, suggestion_evidence)
     VALUES (?, ?, ?, ?)`
  ).run(personaId, input.prompt_text, input.source, input.evidence);
}

export function getWritingPromptHistory(db: Database.Database, personaId: number): WritingPromptHistoryRow[] {
  return db
    .prepare("SELECT * FROM writing_prompt_history WHERE persona_id = ? ORDER BY id DESC")
    .all(personaId) as WritingPromptHistoryRow[];
}
