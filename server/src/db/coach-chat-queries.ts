import type Database from "better-sqlite3";

export interface CoachSession {
  id: number;
  persona_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoachMessage {
  id: number;
  session_id: number;
  role: string;
  content: string;
  tool_blocks_json: string | null;
  created_at: string;
}

export function createCoachSession(db: Database.Database, personaId: number, title?: string): number {
  const result = db
    .prepare("INSERT INTO coach_chat_sessions (persona_id, title) VALUES (?, ?)")
    .run(personaId, title ?? null);
  return Number(result.lastInsertRowid);
}

export function getCoachSession(db: Database.Database, sessionId: number): CoachSession | undefined {
  return db
    .prepare("SELECT * FROM coach_chat_sessions WHERE id = ?")
    .get(sessionId) as CoachSession | undefined;
}

export function listCoachSessions(db: Database.Database, personaId: number, limit: number = 20): CoachSession[] {
  return db
    .prepare("SELECT * FROM coach_chat_sessions WHERE persona_id = ? ORDER BY updated_at DESC LIMIT ?")
    .all(personaId, limit) as CoachSession[];
}

export function insertCoachMessage(
  db: Database.Database,
  data: { session_id: number; role: string; content: string; tool_blocks_json?: string }
): number {
  const result = db
    .prepare(
      "INSERT INTO coach_chat_messages (session_id, role, content, tool_blocks_json) VALUES (?, ?, ?, ?)"
    )
    .run(data.session_id, data.role, data.content, data.tool_blocks_json ?? null);
  db.prepare(
    "UPDATE coach_chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(data.session_id);
  return Number(result.lastInsertRowid);
}

export function getCoachMessages(db: Database.Database, sessionId: number, limit: number = 20): CoachMessage[] {
  return db
    .prepare("SELECT * FROM coach_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?")
    .all(sessionId, limit) as CoachMessage[];
}
