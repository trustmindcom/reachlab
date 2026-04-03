import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { initDatabase } from "../db/index.js";
import {
  GHOSTWRITER_TOOLS,
  createGhostwriterState,
  executeGhostwriterTool,
} from "../ai/ghostwriter-tools.js";
import { PLATFORM_KNOWLEDGE } from "../ai/platform-knowledge.js";
import type { AiLogger } from "../ai/logger.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-ghostwriter-tools.db");

let db: Database.Database;

// Minimal mock logger — ghostwriter tool tests don't exercise logging
const mockLogger = {
  log: () => {},
} as unknown as AiLogger;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);

  // Seed author profile
  db.prepare(
    "INSERT OR REPLACE INTO author_profile (persona_id, profile_text, profile_json, interview_count) VALUES (?, ?, ?, ?)"
  ).run(1, "Senior engineer who writes about distributed systems.", "{}", 2);

  // Seed some generation rules
  db.prepare(
    "INSERT INTO generation_rules (persona_id, category, rule_text, sort_order, enabled) VALUES (?, ?, ?, ?, ?)"
  ).run(1, "voice_tone", "Be direct and specific", 0, 1);
  db.prepare(
    "INSERT INTO generation_rules (persona_id, category, rule_text, sort_order, enabled) VALUES (?, ?, ?, ?, ?)"
  ).run(1, "anti_ai_tropes", "No hedge words", 1, 1);
  db.prepare(
    "INSERT INTO generation_rules (persona_id, category, rule_text, sort_order, enabled) VALUES (?, ?, ?, ?, ?)"
  ).run(1, "voice_tone", "Disabled rule", 2, 0);

  // Seed posts with metrics for search
  db.prepare(
    "INSERT INTO posts (id, content_preview, full_text, content_type, published_at, persona_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("post-1", "Distributed systems are hard", "Distributed systems are hard. Here is what I learned building a cache invalidation layer.", "text", "2026-01-15", 1);
  db.prepare(
    "INSERT INTO posts (id, content_preview, full_text, content_type, published_at, persona_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("post-2", "Leadership lessons", "Leadership lessons from managing a remote team of 15 engineers.", "text", "2026-02-10", 1);
  db.prepare(
    "INSERT INTO posts (id, content_preview, full_text, content_type, published_at, persona_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("post-3", "Another persona post", "Different persona post about cooking.", "text", "2026-03-01", 2);

  // Seed metrics
  db.prepare(
    "INSERT INTO post_metrics (post_id, impressions, engagement_rate, reactions, comments) VALUES (?, ?, ?, ?, ?)"
  ).run("post-1", 5000, 4.2, 120, 45);
  db.prepare(
    "INSERT INTO post_metrics (post_id, impressions, engagement_rate, reactions, comments) VALUES (?, ?, ?, ?, ?)"
  ).run("post-2", 3000, 2.1, 80, 20);
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("GHOSTWRITER_TOOLS definitions", () => {
  it("has 10 tools, each with name, description, and input_schema", () => {
    expect(GHOSTWRITER_TOOLS).toHaveLength(10);
    for (const tool of GHOSTWRITER_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    }
  });

  it("has the expected tool names", () => {
    const names = GHOSTWRITER_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "get_rules",
      "web_search",
      "fetch_url",
      "add_or_update_rule",
      "delete_rule",
      "get_author_profile",
      "lookup_principles",
      "search_past_posts",
      "get_platform_knowledge",
      "update_draft",
    ]);
  });
});

describe("get_author_profile", () => {
  it("returns profile text when profile exists", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "get_author_profile", {}, state, mockLogger);
    expect(result).toContain("Senior engineer");
    expect(result).toContain("distributed systems");
  });

  it("returns fallback message for persona without profile", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 999, "get_author_profile", {}, state, mockLogger);
    expect(result).toContain("No author profile");
  });
});

describe("get_platform_knowledge", () => {
  const ALL_ASPECTS = [
    "hooks",
    "closings",
    "length",
    "format",
    "engagement",
    "timing",
    "comments",
    "dwell_time",
    "topic_authority",
  ];

  it("returns content for all 9 aspects", async () => {
    const state = createGhostwriterState("");
    for (const aspect of ALL_ASPECTS) {
      const result = await executeGhostwriterTool(
        db,
        1,
        "get_platform_knowledge",
        { aspect },
        state,
        mockLogger
      );
      expect(result.length).toBeGreaterThan(50);
      expect(result).not.toContain("No platform knowledge");
    }
  });

  it("returns error for unknown aspect", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(
      db,
      1,
      "get_platform_knowledge",
      { aspect: "nonexistent" },
      state,
      mockLogger
    );
    expect(result).toContain("No platform knowledge");
  });
});

describe("lookup_principles", () => {
  it("returns a string (empty-state message when none exist)", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "lookup_principles", {}, state, mockLogger);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns principles when they exist", async () => {
    // Insert a principle
    db.prepare(
      "INSERT INTO editorial_principles (persona_id, principle_text, confidence) VALUES (?, ?, ?)"
    ).run(1, "Start with a strong claim", 0.8);

    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "lookup_principles", {}, state, mockLogger);
    expect(result).toContain("Start with a strong claim");
    expect(result).toContain("0.8");

    // Clean up
    db.prepare("DELETE FROM editorial_principles WHERE persona_id = 1").run();
  });
});

describe("get_rules", () => {
  it("returns enabled rules formatted with id, category, origin, and text", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "get_rules", {}, state, mockLogger);
    expect(result).toContain("[voice_tone]");
    expect(result).toContain("Be direct and specific");
    expect(result).toContain("[anti_ai_tropes]");
    expect(result).toContain("No hedge words");
    expect(result).toContain("[id:");
    // Should NOT contain disabled rule
    expect(result).not.toContain("Disabled rule");
  });

  it("returns empty message for persona with no rules", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 999, "get_rules", {}, state, mockLogger);
    expect(result).toContain("No writing rules configured");
  });
});

describe("update_draft", () => {
  it("updates per-request state", async () => {
    const state = createGhostwriterState("initial draft text here");
    const result = await executeGhostwriterTool(db, 1, "update_draft", {
      draft: "This is the revised draft with improvements and more detail.",
      change_summary: "Expanded the introduction",
    }, state, mockLogger);
    expect(result).toContain("Draft updated");
    expect(result).toContain("Expanded the introduction");
    expect(state.currentDraft).toBe("This is the revised draft with improvements and more detail.");
    expect(state.lastChangeSummary).toBe("Expanded the introduction");
  });

  it("rejects empty draft", async () => {
    const state = createGhostwriterState("original");
    const result = await executeGhostwriterTool(db, 1, "update_draft", {
      draft: "",
      change_summary: "cleared it",
    }, state, mockLogger);
    expect(result).toContain("Error");
    expect(result).toContain("at least 10 characters");
    // State should NOT have changed
    expect(state.currentDraft).toBe("original");
  });

  it("rejects short draft (under 10 chars)", async () => {
    const state = createGhostwriterState("original");
    const result = await executeGhostwriterTool(db, 1, "update_draft", {
      draft: "short",
      change_summary: "too short",
    }, state, mockLogger);
    expect(result).toContain("Error");
    expect(state.currentDraft).toBe("original");
  });

  it("rejects whitespace-only draft", async () => {
    const state = createGhostwriterState("original");
    const result = await executeGhostwriterTool(db, 1, "update_draft", {
      draft: "         ",
      change_summary: "spaces",
    }, state, mockLogger);
    expect(result).toContain("Error");
    expect(state.currentDraft).toBe("original");
  });
});

describe("concurrent state isolation", () => {
  it("two separate state objects don't interfere", async () => {
    const state1 = createGhostwriterState("draft one");
    const state2 = createGhostwriterState("draft two");

    await executeGhostwriterTool(db, 1, "update_draft", {
      draft: "Updated draft one with new content here",
      change_summary: "changed state 1",
    }, state1, mockLogger);

    // state2 should be unchanged
    expect(state2.currentDraft).toBe("draft two");
    expect(state2.lastChangeSummary).toBe("");

    await executeGhostwriterTool(db, 1, "update_draft", {
      draft: "Updated draft two with different content",
      change_summary: "changed state 2",
    }, state2, mockLogger);

    // Both should have their own values
    expect(state1.currentDraft).toBe("Updated draft one with new content here");
    expect(state1.lastChangeSummary).toBe("changed state 1");
    expect(state2.currentDraft).toBe("Updated draft two with different content");
    expect(state2.lastChangeSummary).toBe("changed state 2");
  });
});

describe("unknown tool", () => {
  it("returns error string without throwing", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "nonexistent_tool", {}, state, mockLogger);
    expect(result).toContain("Unknown tool: nonexistent_tool");
  });
});

describe("tool execution error handling", () => {
  it("catches errors from a closed DB and returns error string", async () => {
    const closedDb = initDatabase(
      path.join(import.meta.dirname, "../../data/test-ghostwriter-closed.db")
    );
    closedDb.close();

    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(closedDb, 1, "get_author_profile", {}, state, mockLogger);
    expect(result).toContain("Tool error");
    expect(result).toContain("get_author_profile");

    // Clean up
    try {
      fs.unlinkSync(path.join(import.meta.dirname, "../../data/test-ghostwriter-closed.db"));
      fs.unlinkSync(path.join(import.meta.dirname, "../../data/test-ghostwriter-closed.db-wal"));
      fs.unlinkSync(path.join(import.meta.dirname, "../../data/test-ghostwriter-closed.db-shm"));
    } catch {}
  });
});

describe("search_past_posts", () => {
  it("finds posts matching query", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "distributed",
    }, state, mockLogger);
    expect(result).toContain("cache invalidation");
    expect(result).toContain("5000 impressions");
  });

  it("respects persona isolation", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "cooking",
    }, state, mockLogger);
    expect(result).toContain("No posts found");
  });

  it("falls back to default sort for invalid sort_by", async () => {
    const state = createGhostwriterState("");
    // Should not throw, just use impressions default
    const result = await executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "distributed",
      sort_by: "invalid_column",
    }, state, mockLogger);
    expect(result).toContain("Distributed");
    expect(result).not.toContain("Error");
  });

  it("caps limit at 10", async () => {
    const state = createGhostwriterState("");
    // Even with limit 100, it shouldn't error (capped internally)
    const result = await executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "distributed",
      limit: 100,
    }, state, mockLogger);
    expect(result).toContain("Distributed");
  });

  it("returns no results message for unmatched query", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "quantum_physics_xyz",
    }, state, mockLogger);
    expect(result).toContain("No posts found");
  });

  it("escapes LIKE wildcards in query", async () => {
    const state = createGhostwriterState("");
    // % and _ should be escaped, not treated as wildcards
    const result = await executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "100%_success",
    }, state, mockLogger);
    // Should not match anything (the wildcards were escaped)
    expect(result).toContain("No posts found");
  });
});

describe("add_or_update_rule", () => {
  it("adds a new rule and returns confirmation", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "add_or_update_rule", {
      category: "voice_tone",
      rule_text: "Use short sentences for impact",
    }, state, mockLogger);
    expect(result).toContain("Rule added");
    expect(result).toContain("[voice_tone]");
    expect(result).toContain("Use short sentences for impact");

    // Confirm it was persisted
    const rows = db.prepare(
      "SELECT * FROM generation_rules WHERE persona_id = 1 AND rule_text = ? AND origin = 'auto'"
    ).all("Use short sentences for impact");
    expect(rows).toHaveLength(1);

    // Clean up
    db.prepare("DELETE FROM generation_rules WHERE rule_text = 'Use short sentences for impact'").run();
  });

  it("updates an existing rule by id", async () => {
    // Insert a rule to update
    db.prepare(
      "INSERT INTO generation_rules (persona_id, category, rule_text, sort_order, enabled, origin) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(1, "structure", "Original rule text", 99, 1, "manual");
    const row = db.prepare(
      "SELECT id FROM generation_rules WHERE rule_text = 'Original rule text' AND persona_id = 1"
    ).get() as { id: number };

    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "add_or_update_rule", {
      category: "structure",
      rule_text: "Updated rule text",
      rule_id: row.id,
    }, state, mockLogger);
    expect(result).toContain("Rule updated");
    expect(result).toContain(`id:${row.id}`);
    expect(result).toContain("Updated rule text");

    // Confirm DB was updated
    const updated = db.prepare("SELECT rule_text FROM generation_rules WHERE id = ?").get(row.id) as { rule_text: string };
    expect(updated.rule_text).toBe("Updated rule text");

    // Clean up
    db.prepare("DELETE FROM generation_rules WHERE id = ?").run(row.id);
  });

  it("returns error when rule_text is missing", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "add_or_update_rule", {
      category: "voice_tone",
      rule_text: "",
    }, state, mockLogger);
    expect(result).toContain("Error");
    expect(result).toContain("rule_text is required");
  });

  it("defaults category to voice_tone when not a string", async () => {
    const state = createGhostwriterState("");
    const result = await executeGhostwriterTool(db, 1, "add_or_update_rule", {
      rule_text: "A rule with no category provided",
    }, state, mockLogger);
    expect(result).toContain("Rule added");
    expect(result).toContain("[voice_tone]");

    // Clean up
    db.prepare("DELETE FROM generation_rules WHERE rule_text = 'A rule with no category provided'").run();
  });
});
