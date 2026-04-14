import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { initDatabase } from "../db/index.js";
import {
  getRules,
  getRulesByCategory,
  softDeleteRule,
  restoreRule,
  replaceAllRules,
  getAntiAiTropesEnabled,
  getMaxRuleSortOrder,
  insertSingleRule,
  updateRule,
  getRuleCount,
  seedDefaultRules,
  DEFAULT_RULES,
  insertEditorialPrinciple,
  getEditorialPrinciples,
  confirmPrinciple,
  pruneStaleEditorialPrinciples,
} from "../db/generate-queries.js";

const TEST_DB_PATH = path.join(
  import.meta.dirname,
  "../../data/test-rule-queries.db"
);
const PID = 1;

let db: ReturnType<typeof initDatabase>;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

beforeEach(() => {
  // Clean state before each test
  db.prepare("DELETE FROM generation_rules WHERE persona_id = ?").run(PID);
  db.prepare("DELETE FROM editorial_principles WHERE persona_id = ?").run(PID);
});

// ── rule CRUD & lifecycle ──────────────────────────────────

describe("softDeleteRule / restoreRule", () => {
  it("hides a rule from getRules after soft-delete", () => {
    insertSingleRule(db, PID, "voice_tone", "to delete", 0);
    const before = getRules(db, PID);
    expect(before).toHaveLength(1);

    const ok = softDeleteRule(db, before[0].id, PID);
    expect(ok).toBe(true);
    expect(getRules(db, PID)).toHaveLength(0);
  });

  it("returns false when rule id doesn't exist", () => {
    expect(softDeleteRule(db, 999999, PID)).toBe(false);
  });

  it("returns false when persona mismatch", () => {
    insertSingleRule(db, PID, "voice_tone", "owned by 1", 0);
    const id = getRules(db, PID)[0].id;
    expect(softDeleteRule(db, id, 9999)).toBe(false);
  });

  it("restoreRule brings back a deleted rule", () => {
    insertSingleRule(db, PID, "voice_tone", "restore me", 0);
    const id = getRules(db, PID)[0].id;
    softDeleteRule(db, id, PID);
    expect(getRules(db, PID)).toHaveLength(0);

    const ok = restoreRule(db, id, PID);
    expect(ok).toBe(true);
    expect(getRules(db, PID)).toHaveLength(1);
  });

  it("getRules excludes soft-deleted rules", () => {
    insertSingleRule(db, PID, "voice_tone", "keep", 0);
    insertSingleRule(db, PID, "voice_tone", "drop", 1);
    const rules = getRules(db, PID);
    softDeleteRule(db, rules.find((r) => r.rule_text === "drop")!.id, PID);

    const remaining = getRules(db, PID);
    expect(remaining.map((r) => r.rule_text)).toEqual(["keep"]);
  });

  it("getRulesByCategory also filters soft-deleted", () => {
    insertSingleRule(db, PID, "voice_tone", "kept", 0);
    insertSingleRule(db, PID, "voice_tone", "gone", 1);
    const rules = getRulesByCategory(db, PID, "voice_tone");
    softDeleteRule(db, rules.find((r) => r.rule_text === "gone")!.id, PID);
    expect(getRulesByCategory(db, PID, "voice_tone").map((r) => r.rule_text)).toEqual(["kept"]);
  });
});

// ── replaceAllRules: the tricky manual/auto coexistence ──

describe("replaceAllRules", () => {
  it("deletes ALL manual rules and inserts the provided ones", () => {
    insertSingleRule(db, PID, "voice_tone", "old manual", 0);
    replaceAllRules(db, PID, [
      { category: "voice_tone", rule_text: "new manual", sort_order: 0 },
    ]);
    const rules = getRules(db, PID);
    expect(rules).toHaveLength(1);
    expect(rules[0].rule_text).toBe("new manual");
    expect(rules[0].origin).toBe("manual");
  });

  it("deletes auto rules not in the provided set", () => {
    insertSingleRule(db, PID, "voice_tone", "auto A", 0, "auto");
    insertSingleRule(db, PID, "voice_tone", "auto B", 1, "auto");
    const autoA = getRules(db, PID).find((r) => r.rule_text === "auto A")!;
    // Replace: only keep auto A (referenced by id)
    replaceAllRules(db, PID, [
      { id: autoA.id, category: "voice_tone", rule_text: "auto A v2", sort_order: 0, origin: "auto" },
    ]);
    const rules = getRules(db, PID);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(autoA.id);
    expect(rules[0].rule_text).toBe("auto A v2");
  });

  it("updates existing auto rules in place (preserves id)", () => {
    insertSingleRule(db, PID, "voice_tone", "original auto", 0, "auto");
    const original = getRules(db, PID)[0];
    replaceAllRules(db, PID, [
      { id: original.id, category: "voice_tone", rule_text: "edited auto", sort_order: 5, enabled: 0, origin: "auto" },
    ]);
    const after = getRules(db, PID);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(original.id);
    expect(after[0].rule_text).toBe("edited auto");
    expect(after[0].sort_order).toBe(5);
    expect(after[0].enabled).toBe(0);
  });

  it("deletes ALL auto rules when no auto rules are provided", () => {
    insertSingleRule(db, PID, "voice_tone", "auto one", 0, "auto");
    insertSingleRule(db, PID, "voice_tone", "auto two", 1, "auto");
    replaceAllRules(db, PID, [
      { category: "voice_tone", rule_text: "manual only", sort_order: 0 },
    ]);
    const rules = getRules(db, PID);
    expect(rules).toHaveLength(1);
    expect(rules[0].origin).toBe("manual");
  });

  it("supports mixed manual + auto payload", () => {
    insertSingleRule(db, PID, "voice_tone", "existing auto", 0, "auto");
    const autoId = getRules(db, PID)[0].id;
    replaceAllRules(db, PID, [
      { category: "voice_tone", rule_text: "fresh manual", sort_order: 0 },
      { id: autoId, category: "voice_tone", rule_text: "updated auto", sort_order: 1, origin: "auto" },
    ]);
    const rules = getRules(db, PID);
    expect(rules).toHaveLength(2);
    expect(rules.find((r) => r.origin === "manual")?.rule_text).toBe("fresh manual");
    expect(rules.find((r) => r.origin === "auto")?.rule_text).toBe("updated auto");
  });

  it("persona-scopes the delete (doesn't touch other persona rules)", () => {
    const OTHER = 999;
    db.prepare("INSERT OR IGNORE INTO users (id, name, api_token) VALUES (1, 'U', 'tok')").run();
    db.prepare("INSERT OR IGNORE INTO personas (id, user_id, name, linkedin_url, type) VALUES (?, 1, 'p2', 'http://li', 'personal')").run(OTHER);
    insertSingleRule(db, OTHER, "voice_tone", "other persona rule", 0);
    insertSingleRule(db, PID, "voice_tone", "my rule", 0);

    replaceAllRules(db, PID, [
      { category: "voice_tone", rule_text: "my replacement", sort_order: 0 },
    ]);

    expect(getRules(db, PID).map((r) => r.rule_text)).toEqual(["my replacement"]);
    expect(getRules(db, OTHER).map((r) => r.rule_text)).toEqual(["other persona rule"]);
    db.prepare("DELETE FROM generation_rules WHERE persona_id = ?").run(OTHER);
    db.prepare("DELETE FROM personas WHERE id = ?").run(OTHER);
  });

  it("treats rules with missing origin as manual", () => {
    replaceAllRules(db, PID, [
      { category: "voice_tone", rule_text: "no origin specified", sort_order: 0 },
    ]);
    expect(getRules(db, PID)[0].origin).toBe("manual");
  });

  it("defaults enabled to 1 when not provided", () => {
    replaceAllRules(db, PID, [
      { category: "voice_tone", rule_text: "default enabled", sort_order: 0 },
    ]);
    expect(getRules(db, PID)[0].enabled).toBe(1);
  });
});

// ── seedDefaultRules + DEFAULT_RULES ──────────────────────

describe("seedDefaultRules + DEFAULT_RULES", () => {
  it("inserts every default rule", () => {
    seedDefaultRules(db, PID);
    expect(getRuleCount(db, PID)).toBe(DEFAULT_RULES.length);
  });

  it("default rules include all three canonical categories", () => {
    const categories = new Set(DEFAULT_RULES.map((r) => r.category));
    expect(categories.has("voice_tone")).toBe(true);
    expect(categories.has("structure_formatting")).toBe(true);
    expect(categories.has("anti_ai_tropes")).toBe(true);
  });

  it("seedDefaultRules is idempotent via replaceAllRules semantics", () => {
    seedDefaultRules(db, PID);
    const firstCount = getRuleCount(db, PID);
    seedDefaultRules(db, PID);
    expect(getRuleCount(db, PID)).toBe(firstCount);
  });
});

// ── getAntiAiTropesEnabled ─────────────────────────────────

describe("getAntiAiTropesEnabled", () => {
  it("defaults to true when no anti_ai_tropes rules exist", () => {
    expect(getAntiAiTropesEnabled(db, PID)).toBe(true);
  });

  it("returns true when anti_ai_tropes rule is enabled", () => {
    insertSingleRule(db, PID, "anti_ai_tropes", "no hedging", 0);
    expect(getAntiAiTropesEnabled(db, PID)).toBe(true);
  });

  it("returns false when anti_ai_tropes rule is disabled", () => {
    insertSingleRule(db, PID, "anti_ai_tropes", "no hedging", 0);
    const id = getRules(db, PID)[0].id;
    db.prepare("UPDATE generation_rules SET enabled = 0 WHERE id = ?").run(id);
    expect(getAntiAiTropesEnabled(db, PID)).toBe(false);
  });
});

// ── getMaxRuleSortOrder ────────────────────────────────────

describe("getMaxRuleSortOrder", () => {
  it("returns -1 when no rules in category", () => {
    expect(getMaxRuleSortOrder(db, "voice_tone", PID)).toBe(-1);
  });

  it("returns the max sort_order present", () => {
    insertSingleRule(db, PID, "voice_tone", "a", 0);
    insertSingleRule(db, PID, "voice_tone", "b", 5);
    insertSingleRule(db, PID, "voice_tone", "c", 2);
    expect(getMaxRuleSortOrder(db, "voice_tone", PID)).toBe(5);
  });

  it("filters by category (doesn't see other categories' max)", () => {
    insertSingleRule(db, PID, "voice_tone", "a", 10);
    insertSingleRule(db, PID, "structure_formatting", "b", 3);
    expect(getMaxRuleSortOrder(db, "structure_formatting", PID)).toBe(3);
    expect(getMaxRuleSortOrder(db, "voice_tone", PID)).toBe(10);
  });
});

// ── updateRule ─────────────────────────────────────────────

describe("updateRule", () => {
  it("returns false when no fields provided", () => {
    insertSingleRule(db, PID, "voice_tone", "stub", 0);
    const id = getRules(db, PID)[0].id;
    expect(updateRule(db, id, PID, {})).toBe(false);
  });

  it("updates rule_text only", () => {
    insertSingleRule(db, PID, "voice_tone", "old", 0);
    const id = getRules(db, PID)[0].id;
    expect(updateRule(db, id, PID, { rule_text: "new" })).toBe(true);
    expect(getRules(db, PID)[0].rule_text).toBe("new");
  });

  it("updates example_text (can set to empty)", () => {
    insertSingleRule(db, PID, "voice_tone", "x", 0);
    const id = getRules(db, PID)[0].id;
    updateRule(db, id, PID, { example_text: "example here" });
    expect(getRules(db, PID)[0].example_text).toBe("example here");
    updateRule(db, id, PID, { example_text: "" });
    expect(getRules(db, PID)[0].example_text).toBe("");
  });

  it("returns false when persona mismatch", () => {
    insertSingleRule(db, PID, "voice_tone", "x", 0);
    const id = getRules(db, PID)[0].id;
    expect(updateRule(db, id, 9999, { rule_text: "nope" })).toBe(false);
    expect(getRules(db, PID)[0].rule_text).toBe("x");
  });
});

// ── Editorial principles ───────────────────────────────────

describe("editorial_principles", () => {
  it("inserts with defaults (confidence 0.5, frequency 1 on fresh insert)", () => {
    const id = insertEditorialPrinciple(db, PID, {
      principle_text: "Open with friction",
    });
    expect(id).toBeGreaterThan(0);

    const all = getEditorialPrinciples(db, PID);
    expect(all).toHaveLength(1);
    expect(all[0].principle_text).toBe("Open with friction");
    expect(all[0].confidence).toBe(0.5);
  });

  it("orders by confidence desc then frequency desc", () => {
    insertEditorialPrinciple(db, PID, { principle_text: "low-conf", confidence: 0.2 });
    insertEditorialPrinciple(db, PID, { principle_text: "high-conf", confidence: 0.9 });
    insertEditorialPrinciple(db, PID, { principle_text: "mid-conf", confidence: 0.6 });

    const all = getEditorialPrinciples(db, PID);
    expect(all.map((p) => p.principle_text)).toEqual(["high-conf", "mid-conf", "low-conf"]);
  });

  it("limits to 10 results", () => {
    for (let i = 0; i < 15; i++) {
      insertEditorialPrinciple(db, PID, { principle_text: `p${i}`, confidence: i / 15 });
    }
    expect(getEditorialPrinciples(db, PID)).toHaveLength(10);
  });

  it("filters by post type (matches specific OR null)", () => {
    insertEditorialPrinciple(db, PID, { principle_text: "global", confidence: 0.9 });
    insertEditorialPrinciple(db, PID, { principle_text: "news-only", source_post_type: "news", confidence: 0.8 });
    insertEditorialPrinciple(db, PID, { principle_text: "story-only", source_post_type: "story", confidence: 0.7 });

    const news = getEditorialPrinciples(db, PID, "news");
    expect(news.map((p) => p.principle_text).sort()).toEqual(["global", "news-only"]);
  });

  it("confirmPrinciple increments frequency and bumps confidence (capped at 1.0)", () => {
    const id = insertEditorialPrinciple(db, PID, {
      principle_text: "x",
      confidence: 0.95,
    });
    confirmPrinciple(db, id);
    confirmPrinciple(db, id);
    const all = getEditorialPrinciples(db, PID);
    expect(all[0].frequency).toBe(3); // initial 1 + two confirms
    expect(all[0].confidence).toBe(1.0); // capped
  });

  it("pruneStaleEditorialPrinciples deletes low-frequency old rows", () => {
    // Make one stale with frequency=1 older than 30 days
    db.prepare(
      `INSERT INTO editorial_principles
       (persona_id, principle_text, confidence, frequency, created_at)
       VALUES (?, 'stale', 0.4, 1, datetime('now', '-60 days'))`
    ).run(PID);
    // And one that should survive (recent)
    insertEditorialPrinciple(db, PID, { principle_text: "fresh" });
    // And one with high frequency
    const hfId = insertEditorialPrinciple(db, PID, { principle_text: "durable" });
    confirmPrinciple(db, hfId);
    confirmPrinciple(db, hfId);

    const pruned = pruneStaleEditorialPrinciples(db, PID);
    expect(pruned).toBe(1);
    const remaining = getEditorialPrinciples(db, PID).map((p) => p.principle_text);
    expect(remaining).toContain("fresh");
    expect(remaining).toContain("durable");
    expect(remaining).not.toContain("stale");
  });
});
