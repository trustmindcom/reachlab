import type Database from "better-sqlite3";
import { getPersonaSetting, upsertPersonaSetting } from "./ai-queries.js";

export interface Persona {
  id: number;
  name: string;
  linkedin_url: string;
  type: "personal" | "company_page";
  created_at: string;
}

export function listPersonas(db: Database.Database): Persona[] {
  return db.prepare("SELECT * FROM personas ORDER BY id").all() as Persona[];
}

export function getPersona(db: Database.Database, id: number): Persona | undefined {
  return db.prepare("SELECT * FROM personas WHERE id = ?").get(id) as Persona | undefined;
}

export function createPersona(
  db: Database.Database,
  data: { name: string; linkedin_url: string; type: "personal" | "company_page" }
): Persona {
  return db.transaction(() => {
    const result = db.prepare(
      "INSERT INTO personas (name, linkedin_url, type) VALUES (?, ?, ?)"
    ).run(data.name, data.linkedin_url, data.type);
    const personaId = result.lastInsertRowid as number;

    // Seed new persona with an empty author_profile row so profile queries don't fail
    db.prepare(
      "INSERT OR IGNORE INTO author_profile (persona_id) VALUES (?)"
    ).run(personaId);

    // Copy default RSS sources from persona 1 so the research pipeline works immediately
    db.prepare(`
      INSERT INTO research_sources (name, feed_url, source_type, enabled, persona_id)
      SELECT name, feed_url, source_type, enabled, ?
      FROM research_sources WHERE persona_id = 1
    `).run(personaId);

    // Copy generation rules from persona 1
    db.prepare(`
      INSERT INTO generation_rules (category, rule_text, example_text, sort_order, enabled, persona_id)
      SELECT category, rule_text, example_text, sort_order, enabled, ?
      FROM generation_rules WHERE persona_id = 1
    `).run(personaId);

    // Fork persona-scoped settings from persona 1
    const PERSONA_SCOPED_KEYS = [
      'writing_prompt',
      'auto_interpret_schedule',
      'auto_interpret_post_threshold',
    ];
    for (const key of PERSONA_SCOPED_KEYS) {
      const value = getPersonaSetting(db, 1, key);
      if (value !== null) {
        upsertPersonaSetting(db, personaId, key, value);
      }
    }
    // Discovery labels always init as empty for new personas — no analysis history
    upsertPersonaSetting(db, personaId, 'last_discovery_labels', '[]');

    return getPersona(db, personaId)!;
  })();
}

export function updatePersona(
  db: Database.Database,
  id: number,
  data: { name?: string; linkedin_url?: string }
): void {
  if (data.name != null) {
    db.prepare("UPDATE personas SET name = ? WHERE id = ?").run(data.name, id);
  }
  if (data.linkedin_url != null) {
    db.prepare("UPDATE personas SET linkedin_url = ? WHERE id = ?").run(data.linkedin_url, id);
  }
}
