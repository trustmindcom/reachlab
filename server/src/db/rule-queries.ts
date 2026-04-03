import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────

export interface GenerationRule {
  id: number;
  category: string;
  rule_text: string;
  example_text: string | null;
  sort_order: number;
  enabled: number;
  origin: string;
}

export interface EditorialPrinciple {
  id: number;
  persona_id: number;
  principle_text: string;
  source_post_type: string | null;
  source_context: string | null;
  frequency: number;
  confidence: number;
  last_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Rules ──────────────────────────────────────────────────

export function getRules(db: Database.Database, personaId: number): GenerationRule[] {
  return db
    .prepare("SELECT * FROM generation_rules WHERE persona_id = ? AND deleted_at IS NULL ORDER BY category, sort_order")
    .all(personaId) as GenerationRule[];
}

export function getRulesByCategory(
  db: Database.Database,
  personaId: number,
  category: string
): GenerationRule[] {
  return db
    .prepare("SELECT * FROM generation_rules WHERE persona_id = ? AND category = ? AND deleted_at IS NULL ORDER BY sort_order")
    .all(personaId, category) as GenerationRule[];
}

export function softDeleteRule(db: Database.Database, ruleId: number, personaId: number): boolean {
  const result = db.prepare(
    "UPDATE generation_rules SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND persona_id = ? AND deleted_at IS NULL"
  ).run(ruleId, personaId);
  return result.changes > 0;
}

export function restoreRule(db: Database.Database, ruleId: number, personaId: number): boolean {
  const result = db.prepare(
    "UPDATE generation_rules SET deleted_at = NULL WHERE id = ? AND persona_id = ?"
  ).run(ruleId, personaId);
  return result.changes > 0;
}

export function replaceAllRules(
  db: Database.Database,
  personaId: number,
  rules: Array<{ id?: number; category: string; rule_text: string; example_text?: string; sort_order: number; enabled?: number; origin?: string }>
): void {
  const tx = db.transaction(() => {
    const manualRules = rules.filter((r) => !r.origin || r.origin === "manual");
    const autoRules = rules.filter((r) => r.origin === "auto" && r.id);
    const autoIds = new Set(autoRules.map((r) => r.id));

    db.prepare("DELETE FROM generation_rules WHERE persona_id = ? AND origin = 'manual'").run(personaId);
    if (autoIds.size > 0) {
      const existing = db.prepare("SELECT id FROM generation_rules WHERE persona_id = ? AND origin = 'auto'").all(personaId) as Array<{ id: number }>;
      for (const row of existing) {
        if (!autoIds.has(row.id)) {
          db.prepare("DELETE FROM generation_rules WHERE id = ?").run(row.id);
        }
      }
    } else {
      db.prepare("DELETE FROM generation_rules WHERE persona_id = ? AND origin = 'auto'").run(personaId);
    }

    const insert = db.prepare(
      "INSERT INTO generation_rules (persona_id, category, rule_text, example_text, sort_order, enabled, origin) VALUES (?, ?, ?, ?, ?, ?, 'manual')"
    );
    for (const rule of manualRules) {
      insert.run(personaId, rule.category, rule.rule_text, rule.example_text ?? null, rule.sort_order, rule.enabled ?? 1);
    }

    const update = db.prepare(
      "UPDATE generation_rules SET rule_text = ?, example_text = ?, sort_order = ?, enabled = ? WHERE id = ? AND persona_id = ?"
    );
    for (const rule of autoRules) {
      update.run(rule.rule_text, rule.example_text ?? null, rule.sort_order, rule.enabled ?? 1, rule.id, personaId);
    }
  });
  tx();
}

export function getAntiAiTropesEnabled(db: Database.Database, personaId: number): boolean {
  const row = db
    .prepare("SELECT enabled FROM generation_rules WHERE persona_id = ? AND category = 'anti_ai_tropes' LIMIT 1")
    .get(personaId) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : true;
}

export function getMaxRuleSortOrder(db: Database.Database, category: string, personaId: number): number {
  const row = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) as m FROM generation_rules WHERE category = ? AND persona_id = ?"
  ).get(category, personaId) as { m: number };
  return row.m;
}

export function insertSingleRule(
  db: Database.Database,
  personaId: number,
  category: string,
  ruleText: string,
  sortOrder: number,
  origin: string = "manual"
): void {
  db.prepare(
    "INSERT INTO generation_rules (category, rule_text, sort_order, enabled, persona_id, origin) VALUES (?, ?, ?, 1, ?, ?)"
  ).run(category, ruleText, sortOrder, personaId, origin);
}

export function updateRule(
  db: Database.Database,
  ruleId: number,
  personaId: number,
  fields: { rule_text?: string; example_text?: string }
): boolean {
  const sets: string[] = [];
  const params: any[] = [];
  if (fields.rule_text !== undefined) { sets.push("rule_text = ?"); params.push(fields.rule_text); }
  if (fields.example_text !== undefined) { sets.push("example_text = ?"); params.push(fields.example_text); }
  if (sets.length === 0) return false;
  params.push(ruleId, personaId);
  const result = db.prepare(`UPDATE generation_rules SET ${sets.join(", ")} WHERE id = ? AND persona_id = ?`).run(...params);
  return result.changes > 0;
}

export function getRuleCount(db: Database.Database, personaId: number): number {
  return (db.prepare("SELECT COUNT(*) as count FROM generation_rules WHERE persona_id = ?").get(personaId) as any).count;
}

// ── Default Rules ──────────────────────────────────────────

export const DEFAULT_RULES: Array<{ category: string; rule_text: string; example_text?: string; sort_order: number }> = [
  // Voice & tone
  { category: "voice_tone", rule_text: "Favor concrete specifics over vague abstractions", example_text: 'Favor: "$400/month replacing $400k/year" — Avoid: "cost-effective solution"', sort_order: 0 },
  { category: "voice_tone", rule_text: "Favor embodied experience over generic descriptions", example_text: 'Favor: "I watched the deploy fail at 2am" — Avoid: "deployment issues can occur"', sort_order: 1 },
  { category: "voice_tone", rule_text: "Write with a practitioner voice, not an analyst voice", example_text: 'Favor: "Here\'s what I shipped" — Avoid: "Industry trends suggest"', sort_order: 2 },
  { category: "voice_tone", rule_text: "Use short, declarative sentences for impact. Long sentences for context.", sort_order: 3 },
  { category: "voice_tone", rule_text: "Sound like a person talking to a peer, not a brand talking to an audience", sort_order: 4 },
  // Structure & formatting
  { category: "structure_formatting", rule_text: "One idea per post. If you need a second idea, write a second post.", sort_order: 0 },
  { category: "structure_formatting", rule_text: "Open with friction, a claim, or a surprise — never with context or a question", example_text: 'Favor: "I fired our best engineer last month." — Avoid: "Have you ever wondered about team dynamics?"', sort_order: 1 },
  { category: "structure_formatting", rule_text: "Close with a process question that invites practitioner responses, not opinion questions", example_text: 'Favor: "What\'s your process for X?" — Avoid: "What do you think?"', sort_order: 2 },
  { category: "structure_formatting", rule_text: "End by extending the idea forward, never by summarizing or recapping", sort_order: 3 },
  { category: "structure_formatting", rule_text: "Vary paragraph length for rhythm: single-sentence paragraphs for emphasis, 2-3 sentence paragraphs for flow. Mechanical line breaks after every sentence kills pacing.", sort_order: 4 },
  { category: "structure_formatting", rule_text: "Front-load the practical application, then provide theory if needed", sort_order: 5 },
  // Anti-AI tropes
  { category: "anti_ai_tropes", rule_text: "No hedge words: actually, maybe, just, perhaps, simply, basically, essentially, literally", sort_order: 0 },
  { category: "anti_ai_tropes", rule_text: 'No correlative constructions: "not X, but Y" / "less about X, more about Y"', example_text: 'Instead of "It\'s not about the tools, but the people" — just state the claim directly', sort_order: 1 },
  { category: "anti_ai_tropes", rule_text: "No rhetorical questions as filler or transitions between paragraphs", example_text: 'Remove: "But what does this really mean?" — just make the point', sort_order: 2 },
  { category: "anti_ai_tropes", rule_text: "No meandering introductions — start with the sharpest version of the claim", example_text: 'Avoid: "In today\'s rapidly evolving landscape..." — start with the insight', sort_order: 3 },
  { category: "anti_ai_tropes", rule_text: "No recapping conclusions that summarize what was already said", example_text: 'Avoid: "In summary..." or "The bottom line is..." — extend the idea instead', sort_order: 4 },
  { category: "anti_ai_tropes", rule_text: "No abstract industry analysis without personal stakes or experience", example_text: 'Avoid: "The AI industry is transforming..." — instead share what you built/broke/learned', sort_order: 5 },
  { category: "anti_ai_tropes", rule_text: "No process documentation without emotional arc or narrative tension", sort_order: 6 },
  { category: "anti_ai_tropes", rule_text: "No theory before practical application — lead with what happened, not why it matters conceptually", sort_order: 7 },
  { category: "anti_ai_tropes", rule_text: "No opening with historical context or background — open with friction or a claim", example_text: 'Avoid: "Over the past decade, the industry has seen..." — start with now', sort_order: 8 },
  { category: "anti_ai_tropes", rule_text: 'No "delve", "landscape", "paradigm shift", "leverage", "synergy", "unlock", "game-changer"', sort_order: 9 },
  { category: "anti_ai_tropes", rule_text: "No emoji-heavy formatting or numbered listicles disguised as thought leadership", sort_order: 10 },
];

export function seedDefaultRules(db: Database.Database, personaId: number): void {
  replaceAllRules(db, personaId, DEFAULT_RULES);
}

// ── Editorial Principles ──────────────────────────────────

export function insertEditorialPrinciple(
  db: Database.Database,
  personaId: number,
  data: { principle_text: string; source_post_type?: string; source_context?: string; confidence?: number }
): number {
  const result = db
    .prepare(
      `INSERT INTO editorial_principles (persona_id, principle_text, source_post_type, source_context, confidence)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(personaId, data.principle_text, data.source_post_type ?? null, data.source_context ?? null, data.confidence ?? 0.5);
  return Number(result.lastInsertRowid);
}

export function getEditorialPrinciples(
  db: Database.Database,
  personaId: number,
  postType?: string
): EditorialPrinciple[] {
  if (postType) {
    return db
      .prepare(
        `SELECT * FROM editorial_principles
         WHERE persona_id = ? AND (source_post_type = ? OR source_post_type IS NULL)
         ORDER BY confidence DESC, frequency DESC
         LIMIT 10`
      )
      .all(personaId, postType) as EditorialPrinciple[];
  }
  return db
    .prepare(
      `SELECT * FROM editorial_principles
       WHERE persona_id = ?
       ORDER BY confidence DESC, frequency DESC
       LIMIT 10`
    )
    .all(personaId) as EditorialPrinciple[];
}

export function confirmPrinciple(db: Database.Database, id: number): void {
  db.prepare(
    `UPDATE editorial_principles
     SET frequency = frequency + 1,
         confidence = MIN(1.0, confidence + 0.1),
         updated_at = CURRENT_TIMESTAMP,
         last_confirmed_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(id);
}

export function pruneStaleEditorialPrinciples(db: Database.Database, personaId: number): number {
  const result = db
    .prepare(
      `DELETE FROM editorial_principles
       WHERE persona_id = ? AND frequency <= 1 AND created_at < datetime('now', '-30 days')`
    )
    .run(personaId);
  return result.changes;
}
