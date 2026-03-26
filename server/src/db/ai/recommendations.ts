import type Database from "better-sqlite3";
import { getLatestCompletedRun } from "./runs.js";

// ── Types ──────────────────────────────────────────────────

export interface RecommendationInput {
  run_id: number;
  type: string;
  priority: number;
  confidence: string | number;
  headline: string;
  detail: string;
  action: string;
  evidence_json: string;
}

// ── recommendations ────────────────────────────────────────

export function insertRecommendation(
  db: Database.Database,
  input: RecommendationInput
): number {
  const result = db
    .prepare(
      `INSERT INTO recommendations (run_id, type, priority, confidence, headline, detail, action, evidence_json)
       VALUES (@run_id, @type, @priority, @confidence, @headline, @detail, @action, @evidence_json)`
    )
    .run(input);
  return Number(result.lastInsertRowid);
}

export function getUnresolvedRecommendationHeadlines(
  db: Database.Database,
  personaId: number
): string[] {
  const rows = db
    .prepare(
      `SELECT r.headline FROM recommendations r
       JOIN ai_runs ar ON ar.id = r.run_id
       WHERE ar.persona_id = ? AND r.resolved_at IS NULL`
    )
    .all(personaId) as { headline: string }[];
  return rows.map((r) => r.headline);
}

export function getRecommendations(
  db: Database.Database,
  personaId: number,
  runId?: number
): any[] {
  if (runId != null) {
    return db
      .prepare(
        "SELECT * FROM recommendations WHERE run_id = ? ORDER BY priority ASC"
      )
      .all(runId);
  }
  // Default: latest completed run
  const latest = getLatestCompletedRun(db, personaId);
  if (!latest) return [];
  return db
    .prepare(
      "SELECT * FROM recommendations WHERE run_id = ? ORDER BY priority ASC"
    )
    .all(latest.id);
}

export function updateRecommendationFeedback(
  db: Database.Database,
  id: number,
  feedback: string
): void {
  db.prepare(
    `UPDATE recommendations SET feedback = ?, feedback_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(feedback, id);
}

export function resolveRecommendation(
  db: Database.Database,
  id: number,
  type: "accepted" | "dismissed"
): void {
  db.prepare(
    `UPDATE recommendations SET resolved_at = CURRENT_TIMESTAMP, resolved_type = ? WHERE id = ?`
  ).run(type, id);
}

export function getRecommendationsWithCooldown(
  db: Database.Database,
  personaId: number,
  runId?: number
): { active: any[]; resolved: any[] } {
  const latest = runId ?? getLatestCompletedRun(db, personaId)?.id;
  if (!latest) return { active: [], resolved: [] };

  const allRecs = db
    .prepare("SELECT * FROM recommendations WHERE run_id = ? ORDER BY priority ASC")
    .all(latest);

  // Get recently resolved stable_keys with their cooldown windows
  // Scope to persona through ai_runs
  const recentlyResolved = db
    .prepare(
      `SELECT r.stable_key, r.resolved_type, r.resolved_at, r.headline
       FROM recommendations r
       JOIN ai_runs ar ON ar.id = r.run_id
       WHERE ar.persona_id = ?
         AND r.resolved_at IS NOT NULL
         AND (
           (r.resolved_type = 'accepted' AND r.resolved_at > datetime('now', '-6 months'))
           OR (r.resolved_type = 'dismissed' AND r.resolved_at > datetime('now', '-3 months'))
         )`
    )
    .all(personaId) as { stable_key: string | null; resolved_type: string; resolved_at: string; headline: string }[];

  const cooldownKeys = new Set(
    recentlyResolved.map((r) => r.stable_key ?? r.headline)
  );

  const active: any[] = [];
  const resolved: any[] = [];

  for (const rec of allRecs as any[]) {
    if (rec.resolved_at) {
      resolved.push(rec);
    } else {
      const key = rec.stable_key ?? rec.headline;
      if (cooldownKeys.has(key)) {
        // Skip — in cooldown from a previous resolution
        continue;
      }
      active.push(rec);
    }
  }

  // Also include recently resolved from any run for the resolved section
  const resolvedFromOtherRuns = db
    .prepare(
      `SELECT r.* FROM recommendations r
       JOIN ai_runs ar ON ar.id = r.run_id
       WHERE ar.persona_id = ?
         AND r.resolved_at IS NOT NULL AND r.run_id != ?
       ORDER BY r.resolved_at DESC LIMIT 10`
    )
    .all(personaId, latest) as any[];

  const resolvedIds = new Set(resolved.map((r: any) => r.id));
  for (const r of resolvedFromOtherRuns) {
    if (!resolvedIds.has(r.id)) resolved.push(r);
  }

  return { active, resolved };
}

export function getRecommendationById(db: Database.Database, id: number): { id: number } | undefined {
  return db.prepare("SELECT id FROM recommendations WHERE id = ?").get(id) as { id: number } | undefined;
}

export function markRecommendationActedOn(db: Database.Database, id: number, actedOn: boolean): void {
  db.prepare("UPDATE recommendations SET acted_on = ?, acted_on_at = CURRENT_TIMESTAMP WHERE id = ?").run(actedOn ? 1 : 0, id);
}

export function getRecentFeedbackWithReasons(
  db: Database.Database,
  personaId: number
): { headline: string; feedback: string; reason: string | null }[] {
  const rows = db
    .prepare(
      `SELECT r.headline, r.feedback FROM recommendations r
       JOIN ai_runs ar ON ar.id = r.run_id
       WHERE ar.persona_id = ?
         AND r.feedback IS NOT NULL
       ORDER BY r.feedback_at DESC
       LIMIT 20`
    )
    .all(personaId) as { headline: string; feedback: string }[];

  return rows.map((row) => {
    try {
      const parsed = JSON.parse(row.feedback);
      return {
        headline: row.headline,
        feedback: parsed.rating ?? row.feedback,
        reason: parsed.reason ?? null,
      };
    } catch {
      return { headline: row.headline, feedback: row.feedback, reason: null };
    }
  });
}
