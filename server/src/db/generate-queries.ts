import type Database from "better-sqlite3";
import type { Story, Draft } from "@reachlab/shared";

export type { Story, Draft };

// ── Re-exports from sub-modules ───────────────────────────
export * from "./rule-queries.js";
export * from "./message-queries.js";
export * from "./retro-queries.js";
export * from "./research-queries.js";

// ── Types ──────────────────────────────────────────────────

export interface CoachingInsight {
  id: number;
  title: string;
  prompt_text: string;
  evidence: string | null;
  status: string;
  source_sync_id: number | null;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
}

export interface PostTypeTemplate {
  id: number;
  post_type: string;
  template_text: string;
}

export interface QualityCheck {
  name: string;
  status: "pass" | "warn";
  detail: string;
}

export interface QualityGate {
  passed: boolean;
  checks: QualityCheck[];
}

// New coach-check quality shape
export interface CoachCheckQuality {
  expertise_needed: Array<{ area: string; question: string }>;
  alignment: Array<{ dimension: string; summary: string }>;
}

export interface GenerationRecord {
  id: number;
  persona_id: number;
  research_id: number | null;
  post_type: string;
  selected_story_index: number | null;
  drafts_json: string | null;
  selected_draft_indices: string | null;
  combining_guidance: string | null;
  final_draft: string | null;
  quality_gate_json: string | null;
  status: string;
  matched_post_id: string | null;
  prompt_snapshot: string | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cost_cents: number | null;
  personal_connection: string | null;
  draft_length: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoachingChange {
  id: number;
  sync_id: number;
  insight_id: number | null;
  change_type: string;
  old_text: string | null;
  new_text: string | null;
  evidence: string | null;
  decision: string | null;
  decided_at: string | null;
}

// ── Coaching Insights ──────────────────────────────────────

export function getActiveCoachingInsights(db: Database.Database, personaId: number): CoachingInsight[] {
  return db
    .prepare("SELECT * FROM coaching_insights WHERE persona_id = ? AND status = 'active' ORDER BY created_at")
    .all(personaId) as CoachingInsight[];
}

export function getAllCoachingInsights(db: Database.Database, personaId: number): CoachingInsight[] {
  return db
    .prepare("SELECT * FROM coaching_insights WHERE persona_id = ? ORDER BY created_at DESC")
    .all(personaId) as CoachingInsight[];
}

export function insertCoachingInsight(
  db: Database.Database,
  personaId: number,
  insight: { title: string; prompt_text: string; evidence?: string; source_sync_id?: number }
): number {
  const result = db
    .prepare(
      "INSERT INTO coaching_insights (persona_id, title, prompt_text, evidence, source_sync_id) VALUES (?, ?, ?, ?, ?)"
    )
    .run(personaId, insight.title, insight.prompt_text, insight.evidence ?? null, insight.source_sync_id ?? null);
  return Number(result.lastInsertRowid);
}

export function updateCoachingInsight(
  db: Database.Database,
  id: number,
  updates: { prompt_text?: string; status?: string; retired_at?: string }
): void {
  const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const params: any[] = [];
  if (updates.prompt_text !== undefined) {
    sets.push("prompt_text = ?");
    params.push(updates.prompt_text);
  }
  if (updates.status !== undefined) {
    sets.push("status = ?");
    params.push(updates.status);
  }
  if (updates.retired_at !== undefined) {
    sets.push("retired_at = ?");
    params.push(updates.retired_at);
  }
  params.push(id);
  db.prepare(`UPDATE coaching_insights SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

// ── Post Type Templates ────────────────────────────────────

export function getPostTypeTemplate(
  db: Database.Database,
  postType: string
): PostTypeTemplate | undefined {
  return db
    .prepare("SELECT * FROM post_type_templates WHERE post_type = ?")
    .get(postType) as PostTypeTemplate | undefined;
}

// ── Generations ────────────────────────────────────────────

export function insertGeneration(
  db: Database.Database,
  personaId: number,
  data: {
    research_id: number;
    post_type: string;
    selected_story_index: number;
    drafts_json: string;
    prompt_snapshot?: string;
    personal_connection?: string;
    draft_length?: string;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO generations (persona_id, research_id, post_type, selected_story_index, drafts_json, prompt_snapshot, personal_connection, draft_length)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(personaId, data.research_id, data.post_type, data.selected_story_index, data.drafts_json, data.prompt_snapshot ?? null, data.personal_connection ?? null, data.draft_length ?? null);
  return Number(result.lastInsertRowid);
}

export function getGeneration(
  db: Database.Database,
  id: number
): GenerationRecord | undefined {
  return db
    .prepare("SELECT * FROM generations WHERE id = ?")
    .get(id) as GenerationRecord | undefined;
}

export function updateGeneration(
  db: Database.Database,
  id: number,
  updates: Partial<{
    selected_draft_indices: string;
    combining_guidance: string;
    final_draft: string;
    quality_gate_json: string;
    status: string;
    matched_post_id: string;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_cents: number;
    prompt_snapshot: string;
    published_text: string;
    drafts_json: string;
  }>
): void {
  const ALLOWED_COLUMNS = new Set([
    "selected_draft_indices", "combining_guidance", "final_draft",
    "quality_gate_json", "status", "matched_post_id",
    "total_input_tokens", "total_output_tokens", "total_cost_cents",
    "prompt_snapshot", "published_text", "drafts_json",
  ]);
  const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const params: any[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && ALLOWED_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }
  params.push(id);
  db.prepare(`UPDATE generations SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function listGenerations(
  db: Database.Database,
  personaId: number,
  opts: { status?: string; offset?: number; limit?: number }
): { generations: GenerationRecord[]; total: number } {
  let where: string;
  let params: any[];
  if (opts.status === "active") {
    where = "WHERE persona_id = ? AND status IN ('draft', 'copied')";
    params = [personaId];
  } else if (opts.status && opts.status !== "all") {
    where = "WHERE persona_id = ? AND status = ?";
    params = [personaId, opts.status];
  } else {
    where = "WHERE persona_id = ?";
    params = [personaId];
  }

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM generations ${where}`).get(...params) as { count: number }
  ).count;

  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const rows = db
    .prepare(`SELECT * FROM generations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as GenerationRecord[];

  return { generations: rows, total };
}

// ── Auto-Retro Matching ───────────────────────────────────

export function getUnmatchedGenerations(
  db: Database.Database,
  personaId: number,
  daysBack: number = 90
): Array<{ id: number; final_draft: string; created_at: string }> {
  return db
    .prepare(
      `SELECT id, final_draft, created_at FROM generations
       WHERE persona_id = ?
         AND final_draft IS NOT NULL
         AND matched_post_id IS NULL
         AND status IN ('draft', 'copied')
         AND created_at > datetime('now', '-' || ? || ' days')
       ORDER BY created_at DESC`
    )
    .all(personaId, daysBack) as any[];
}

// ── Revisions ──────────────────────────────────────────────

export function insertRevision(
  db: Database.Database,
  data: {
    generation_id: number;
    action: string;
    instruction?: string;
    input_draft: string;
    output_draft: string;
    quality_gate_json?: string;
    input_tokens?: number;
    output_tokens?: number;
    cost_cents?: number;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO generation_revisions
       (generation_id, action, instruction, input_draft, output_draft, quality_gate_json, input_tokens, output_tokens, cost_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.generation_id,
      data.action,
      data.instruction ?? null,
      data.input_draft,
      data.output_draft,
      data.quality_gate_json ?? null,
      data.input_tokens ?? null,
      data.output_tokens ?? null,
      data.cost_cents ?? null
    );
  return Number(result.lastInsertRowid);
}

// ── Coaching Syncs ─────────────────────────────────────────

export function insertCoachingSync(
  db: Database.Database,
  personaId: number,
  changes_json: string
): number {
  const result = db
    .prepare("INSERT INTO coaching_syncs (persona_id, changes_json) VALUES (?, ?)")
    .run(personaId, changes_json);
  return Number(result.lastInsertRowid);
}

export function getCoachingSync(
  db: Database.Database,
  id: number
): { id: number; changes_json: string; decisions_json: string | null; accepted_count: number; skipped_count: number; status: string } | undefined {
  return db
    .prepare("SELECT * FROM coaching_syncs WHERE id = ?")
    .get(id) as any;
}

export function completeCoachingSync(
  db: Database.Database,
  id: number,
  decisions_json: string,
  accepted: number,
  skipped: number
): void {
  db.prepare(
    `UPDATE coaching_syncs SET status = 'completed', decisions_json = ?, accepted_count = ?, skipped_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(decisions_json, accepted, skipped, id);
}

// ── Coaching Change Log ────────────────────────────────────

export function insertCoachingChangeLog(
  db: Database.Database,
  data: {
    sync_id: number;
    insight_id?: number;
    change_type: string;
    old_text?: string;
    new_text?: string;
    evidence?: string;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO coaching_change_log (sync_id, insight_id, change_type, old_text, new_text, evidence)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(data.sync_id, data.insight_id ?? null, data.change_type, data.old_text ?? null, data.new_text ?? null, data.evidence ?? null);
  return Number(result.lastInsertRowid);
}

export function updateCoachingChangeDecision(
  db: Database.Database,
  id: number,
  decision: string
): void {
  db.prepare(
    "UPDATE coaching_change_log SET decision = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(decision, id);
}

export function getCoachingChangeLog(
  db: Database.Database,
  syncId: number
): CoachingChange[] {
  return db
    .prepare("SELECT * FROM coaching_change_log WHERE sync_id = ? ORDER BY id")
    .all(syncId) as CoachingChange[];
}

export function getCoachingSyncHistory(
  db: Database.Database,
  personaId: number
): Array<{ id: number; accepted_count: number; skipped_count: number; status: string; created_at: string; completed_at: string | null }> {
  return db
    .prepare("SELECT id, accepted_count, skipped_count, status, created_at, completed_at FROM coaching_syncs WHERE persona_id = ? ORDER BY id DESC LIMIT 20")
    .all(personaId) as any[];
}

// ── Topic Log ──────────────────────────────────────────────

export function insertTopicLog(
  db: Database.Database,
  data: { generation_id: number; topic_category?: string; was_stretch?: boolean }
): void {
  db.prepare(
    "INSERT INTO generation_topic_log (generation_id, topic_category, was_stretch) VALUES (?, ?, ?)"
  ).run(data.generation_id, data.topic_category ?? null, data.was_stretch ? 1 : 0);
}

export function getRecentStoryHeadlines(db: Database.Database, personaId: number, limit: number): string[] {
  const rows = db
    .prepare("SELECT stories_json FROM generation_research WHERE persona_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(personaId, limit) as { stories_json: string }[];
  const headlines: string[] = [];
  for (const row of rows) {
    try {
      const stories = JSON.parse(row.stories_json) as Story[];
      headlines.push(...stories.map((s) => s.headline));
    } catch {
      // Skip rows with malformed JSON
    }
  }
  return headlines;
}

export function getRecentTopics(
  db: Database.Database,
  personaId: number,
  limit: number = 10
): Array<{ topic_category: string; was_stretch: number; created_at: string }> {
  return db
    .prepare(
      `SELECT tl.topic_category, tl.was_stretch, tl.created_at
       FROM generation_topic_log tl
       JOIN generations g ON g.id = tl.generation_id
       WHERE g.persona_id = ?
       ORDER BY tl.created_at DESC LIMIT ?`
    )
    .all(personaId, limit) as any[];
}

// ── Coaching change lookup ──────────────────────────────

export function getCoachingChange(db: Database.Database, id: number): any | undefined {
  return db.prepare("SELECT * FROM coaching_change_log WHERE id = ?").get(id);
}

// ── Active generation (auto-restore) ────────────────────

export function getActiveGeneration(db: Database.Database, personaId: number): GenerationRecord | undefined {
  // Only restore generations that have drafts (step 2+). Step-1-only work (topic + research
  // but no drafts yet) is excluded intentionally — research is cheap to redo and the user
  // hasn't invested significant review effort at that point.
  return db.prepare(`
    SELECT * FROM generations
    WHERE persona_id = ?
      AND status = 'draft'
      AND drafts_json IS NOT NULL
      AND json_valid(drafts_json)
      AND json_array_length(drafts_json) > 0
      AND updated_at > datetime('now', '-7 days')
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(personaId) as GenerationRecord | undefined;
}
