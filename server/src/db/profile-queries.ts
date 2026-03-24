import type Database from "better-sqlite3";

export interface AuthorProfile {
  id: number;
  profile_text: string;
  profile_json: string;
  interview_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProfileInterview {
  id: number;
  transcript_json: string;
  extracted_profile: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export function getAuthorProfile(db: Database.Database, personaId: number): AuthorProfile | undefined {
  return db.prepare("SELECT * FROM author_profile WHERE persona_id = ?").get(personaId) as AuthorProfile | undefined;
}

export function upsertAuthorProfile(
  db: Database.Database,
  personaId: number,
  data: { profile_text: string; profile_json?: string }
): void {
  const existing = getAuthorProfile(db, personaId);
  if (existing) {
    const sets = ["profile_text = ?", "updated_at = CURRENT_TIMESTAMP"];
    const params: any[] = [data.profile_text];
    if (data.profile_json !== undefined) {
      sets.push("profile_json = ?");
      params.push(data.profile_json);
    }
    params.push(personaId);
    db.prepare(`UPDATE author_profile SET ${sets.join(", ")} WHERE persona_id = ?`).run(...params);
  } else {
    db.prepare(
      "INSERT INTO author_profile (persona_id, profile_text, profile_json) VALUES (?, ?, ?)"
    ).run(personaId, data.profile_text, data.profile_json ?? "{}");
  }
}

export function incrementInterviewCount(db: Database.Database, personaId: number): void {
  const existing = getAuthorProfile(db, personaId);
  if (existing) {
    db.prepare("UPDATE author_profile SET interview_count = interview_count + 1, updated_at = CURRENT_TIMESTAMP WHERE persona_id = ?").run(personaId);
  }
}

export function insertProfileInterview(
  db: Database.Database,
  personaId: number,
  data: { transcript_json: string; extracted_profile?: string; duration_seconds?: number }
): number {
  const result = db.prepare(
    "INSERT INTO profile_interviews (persona_id, transcript_json, extracted_profile, duration_seconds) VALUES (?, ?, ?, ?)"
  ).run(personaId, data.transcript_json, data.extracted_profile ?? null, data.duration_seconds ?? null);
  return Number(result.lastInsertRowid);
}

export function getProfileInterviews(db: Database.Database, personaId: number): ProfileInterview[] {
  return db.prepare("SELECT * FROM profile_interviews WHERE persona_id = ? ORDER BY created_at DESC LIMIT 20").all(personaId) as ProfileInterview[];
}
