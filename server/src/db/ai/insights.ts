import type Database from "better-sqlite3";
import type { PromptSuggestions } from "@reachlab/shared";
import { getLatestCompletedRun } from "./runs.js";

// ── Types ──────────────────────────────────────────────────

export interface InsightInput {
  run_id: number;
  category: string;
  stable_key: string;
  claim: string;
  evidence: string;
  confidence: string | number;
  direction: string;
  first_seen_run_id: number;
  consecutive_appearances?: number;
}

export interface OverviewInput {
  run_id: number;
  summary_text: string;
  top_performer_post_id: string | null;
  top_performer_reason: string | null;
  quick_insights: string;
  prompt_suggestions_json: string | null;
}

export interface AnalysisGapInput {
  run_id: number | null;
  gap_type: string;
  stable_key: string;
  description: string;
  impact: string;
}

export interface AnalysisGapRow {
  id: number;
  run_id: number | null;
  gap_type: string;
  stable_key: string;
  description: string;
  impact: string;
  times_flagged: number;
  first_seen_at: string;
  last_seen_at: string;
}

// ── insights ───────────────────────────────────────────────

export function insertInsight(
  db: Database.Database,
  input: InsightInput
): number {
  const result = db
    .prepare(
      `INSERT INTO insights (run_id, category, stable_key, claim, evidence, confidence, direction, first_seen_run_id, consecutive_appearances)
       VALUES (@run_id, @category, @stable_key, @claim, @evidence, @confidence, @direction, @first_seen_run_id, @consecutive_appearances)`
    )
    .run({
      ...input,
      consecutive_appearances: input.consecutive_appearances ?? 1,
    });
  return Number(result.lastInsertRowid);
}

export function getActiveInsights(db: Database.Database, personaId: number): any[] {
  return db
    .prepare(
      `SELECT i.* FROM insights i
       JOIN ai_runs ar ON ar.id = i.run_id
       WHERE i.status = 'active' AND ar.persona_id = ?
       ORDER BY i.confidence DESC`
    )
    .all(personaId);
}

export function retireInsight(db: Database.Database, insightId: number): void {
  db.prepare("UPDATE insights SET status = 'retired' WHERE id = ?").run(
    insightId
  );
}

export function insertInsightLineage(
  db: Database.Database,
  insightId: number,
  predecessorId: number,
  relationship: string
): void {
  db.prepare(
    `INSERT INTO insight_lineage (insight_id, predecessor_id, relationship)
     VALUES (?, ?, ?)`
  ).run(insightId, predecessorId, relationship);
}

// ── ai_overview ────────────────────────────────────────────

export function upsertOverview(
  db: Database.Database,
  input: OverviewInput
): void {
  db.transaction(() => {
    db.prepare("DELETE FROM ai_overview WHERE run_id = ?").run(input.run_id);
    db.prepare(
      `INSERT INTO ai_overview
         (run_id, summary_text, top_performer_post_id, top_performer_reason, quick_insights, prompt_suggestions_json)
       VALUES
         (@run_id, @summary_text, @top_performer_post_id, @top_performer_reason, @quick_insights, @prompt_suggestions_json)`
    ).run(input);
  })();
}

export function getLatestOverview(db: Database.Database, personaId: number): any | null {
  const latest = getLatestCompletedRun(db, personaId);
  if (!latest) return null;
  return (
    db
      .prepare("SELECT * FROM ai_overview WHERE run_id = ? LIMIT 1")
      .get(latest.id) ?? null
  );
}

// ── changelog ──────────────────────────────────────────────

export function getChangelog(db: Database.Database, personaId: number): {
  confirmed: any[];
  new_signal: any[];
  reversed: any[];
  retired: any[];
} {
  const latestRun = getLatestCompletedRun(db, personaId);

  if (!latestRun) return { confirmed: [], new_signal: [], reversed: [], retired: [] };

  const confirmed = db
    .prepare(
      `SELECT * FROM insights
       WHERE status = 'active' AND run_id = ? AND consecutive_appearances > 1
       ORDER BY confidence DESC`
    )
    .all(latestRun.id);

  const new_signal = db
    .prepare(
      `SELECT * FROM insights
       WHERE status = 'active' AND run_id = ? AND first_seen_run_id = ?
       ORDER BY confidence DESC`
    )
    .all(latestRun.id, latestRun.id);

  const reversed = db
    .prepare(
      `SELECT * FROM insights
       WHERE run_id = ? AND direction = 'reversed'
       ORDER BY confidence DESC`
    )
    .all(latestRun.id);

  const retired = db
    .prepare(
      `SELECT i.* FROM insights i
       JOIN ai_runs ar ON ar.id = i.run_id
       WHERE i.status = 'retired' AND ar.persona_id = ?
         AND i.run_id = (
           SELECT MAX(i2.run_id) FROM insights i2
           JOIN ai_runs ar2 ON ar2.id = i2.run_id
           WHERE i2.status = 'retired' AND ar2.persona_id = ?
         )
       ORDER BY i.confidence DESC`
    )
    .all(personaId, personaId);

  return { confirmed, new_signal, reversed, retired };
}

// ── ai_analysis_gaps ───────────────────────────────────────

export function upsertAnalysisGap(db: Database.Database, input: AnalysisGapInput): void {
  db.prepare(
    `INSERT INTO ai_analysis_gaps (run_id, gap_type, stable_key, description, impact)
     VALUES (@run_id, @gap_type, @stable_key, @description, @impact)
     ON CONFLICT(gap_type, stable_key) DO UPDATE SET
       description = excluded.description,
       impact = excluded.impact,
       times_flagged = times_flagged + 1,
       last_seen_at = CURRENT_TIMESTAMP,
       run_id = excluded.run_id`
  ).run(input);
}

export function getLatestAnalysisGaps(db: Database.Database, personaId: number): AnalysisGapRow[] {
  return db
    .prepare(
      `SELECT ag.* FROM ai_analysis_gaps ag
       LEFT JOIN ai_runs ar ON ar.id = ag.run_id
       WHERE ar.persona_id = ? OR (ag.run_id IS NULL AND ? = 1)
       ORDER BY ag.times_flagged DESC, ag.last_seen_at DESC`
    )
    .all(personaId, personaId) as AnalysisGapRow[];
}

// ── prompt suggestions (stored in ai_overview) ─────────────

export function getLatestPromptSuggestions(db: Database.Database, personaId: number): PromptSuggestions | null {
  const latest = getLatestCompletedRun(db, personaId);
  if (!latest) return null;
  const row = db
    .prepare("SELECT prompt_suggestions_json FROM ai_overview WHERE run_id = ? LIMIT 1")
    .get(latest.id) as { prompt_suggestions_json: string | null } | undefined;
  if (!row?.prompt_suggestions_json) return null;
  try {
    return JSON.parse(row.prompt_suggestions_json) as PromptSuggestions;
  } catch {
    return null;
  }
}

export function clearPromptSuggestions(db: Database.Database, personaId: number): void {
  db.prepare(
    `UPDATE ai_overview SET prompt_suggestions_json = NULL
     WHERE id = (SELECT MAX(ao.id) FROM ai_overview ao JOIN ai_runs ar ON ao.run_id = ar.id WHERE ar.persona_id = ?)`
  ).run(personaId);
}
