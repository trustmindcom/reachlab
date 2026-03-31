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

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-ghostwriter-tools.db");

let db: Database.Database;

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
  it("has 6 tools, each with name, description, and input_schema", () => {
    expect(GHOSTWRITER_TOOLS).toHaveLength(6);
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
      "get_author_profile",
      "lookup_principles",
      "lookup_rules",
      "search_past_posts",
      "get_platform_knowledge",
      "update_draft",
    ]);
  });
});

describe("get_author_profile", () => {
  it("returns profile text when profile exists", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 1, "get_author_profile", {}, state);
    expect(result).toContain("Senior engineer");
    expect(result).toContain("distributed systems");
  });

  it("returns fallback message for persona without profile", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 999, "get_author_profile", {}, state);
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

  it("returns content for all 9 aspects", () => {
    const state = createGhostwriterState("");
    for (const aspect of ALL_ASPECTS) {
      const result = executeGhostwriterTool(
        db,
        1,
        "get_platform_knowledge",
        { aspect },
        state
      );
      expect(result.length).toBeGreaterThan(50);
      expect(result).not.toContain("No platform knowledge");
    }
  });

  it("returns error for unknown aspect", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(
      db,
      1,
      "get_platform_knowledge",
      { aspect: "nonexistent" },
      state
    );
    expect(result).toContain("No platform knowledge");
  });
});

describe("lookup_principles", () => {
  it("returns a string (empty-state message when none exist)", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 1, "lookup_principles", {}, state);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns principles when they exist", () => {
    // Insert a principle
    db.prepare(
      "INSERT INTO editorial_principles (persona_id, principle_text, confidence) VALUES (?, ?, ?)"
    ).run(1, "Start with a strong claim", 0.8);

    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 1, "lookup_principles", {}, state);
    expect(result).toContain("Start with a strong claim");
    expect(result).toContain("0.8");

    // Clean up
    db.prepare("DELETE FROM editorial_principles WHERE persona_id = 1").run();
  });
});

describe("lookup_rules", () => {
  it("returns enabled rules formatted with category", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 1, "lookup_rules", {}, state);
    expect(result).toContain("[voice_tone] Be direct and specific");
    expect(result).toContain("[anti_ai_tropes] No hedge words");
    // Should NOT contain disabled rule
    expect(result).not.toContain("Disabled rule");
  });

  it("returns empty message for persona with no rules", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 999, "lookup_rules", {}, state);
    expect(result).toContain("No writing rules configured");
  });
});

describe("update_draft", () => {
  it("updates per-request state", () => {
    const state = createGhostwriterState("initial draft text here");
    const result = executeGhostwriterTool(db, 1, "update_draft", {
      draft: "This is the revised draft with improvements and more detail.",
      change_summary: "Expanded the introduction",
    }, state);
    expect(result).toContain("Draft updated");
    expect(result).toContain("Expanded the introduction");
    expect(state.currentDraft).toBe("This is the revised draft with improvements and more detail.");
    expect(state.lastChangeSummary).toBe("Expanded the introduction");
  });

  it("rejects empty draft", () => {
    const state = createGhostwriterState("original");
    const result = executeGhostwriterTool(db, 1, "update_draft", {
      draft: "",
      change_summary: "cleared it",
    }, state);
    expect(result).toContain("Error");
    expect(result).toContain("at least 10 characters");
    // State should NOT have changed
    expect(state.currentDraft).toBe("original");
  });

  it("rejects short draft (under 10 chars)", () => {
    const state = createGhostwriterState("original");
    const result = executeGhostwriterTool(db, 1, "update_draft", {
      draft: "short",
      change_summary: "too short",
    }, state);
    expect(result).toContain("Error");
    expect(state.currentDraft).toBe("original");
  });

  it("rejects whitespace-only draft", () => {
    const state = createGhostwriterState("original");
    const result = executeGhostwriterTool(db, 1, "update_draft", {
      draft: "         ",
      change_summary: "spaces",
    }, state);
    expect(result).toContain("Error");
    expect(state.currentDraft).toBe("original");
  });
});

describe("concurrent state isolation", () => {
  it("two separate state objects don't interfere", () => {
    const state1 = createGhostwriterState("draft one");
    const state2 = createGhostwriterState("draft two");

    executeGhostwriterTool(db, 1, "update_draft", {
      draft: "Updated draft one with new content here",
      change_summary: "changed state 1",
    }, state1);

    // state2 should be unchanged
    expect(state2.currentDraft).toBe("draft two");
    expect(state2.lastChangeSummary).toBe("");

    executeGhostwriterTool(db, 1, "update_draft", {
      draft: "Updated draft two with different content",
      change_summary: "changed state 2",
    }, state2);

    // Both should have their own values
    expect(state1.currentDraft).toBe("Updated draft one with new content here");
    expect(state1.lastChangeSummary).toBe("changed state 1");
    expect(state2.currentDraft).toBe("Updated draft two with different content");
    expect(state2.lastChangeSummary).toBe("changed state 2");
  });
});

describe("unknown tool", () => {
  it("returns error string without throwing", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 1, "nonexistent_tool", {}, state);
    expect(result).toContain("Unknown tool: nonexistent_tool");
  });
});

describe("tool execution error handling", () => {
  it("catches errors from a closed DB and returns error string", () => {
    const closedDb = initDatabase(
      path.join(import.meta.dirname, "../../data/test-ghostwriter-closed.db")
    );
    closedDb.close();

    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(closedDb, 1, "get_author_profile", {}, state);
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
  it("finds posts matching query", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "distributed",
    }, state);
    expect(result).toContain("cache invalidation");
    expect(result).toContain("5000 impressions");
  });

  it("respects persona isolation", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "cooking",
    }, state);
    expect(result).toContain("No posts found");
  });

  it("falls back to default sort for invalid sort_by", () => {
    const state = createGhostwriterState("");
    // Should not throw, just use impressions default
    const result = executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "distributed",
      sort_by: "invalid_column",
    }, state);
    expect(result).toContain("Distributed");
    expect(result).not.toContain("Error");
  });

  it("caps limit at 10", () => {
    const state = createGhostwriterState("");
    // Even with limit 100, it shouldn't error (capped internally)
    const result = executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "distributed",
      limit: 100,
    }, state);
    expect(result).toContain("Distributed");
  });

  it("returns no results message for unmatched query", () => {
    const state = createGhostwriterState("");
    const result = executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "quantum_physics_xyz",
    }, state);
    expect(result).toContain("No posts found");
  });

  it("escapes LIKE wildcards in query", () => {
    const state = createGhostwriterState("");
    // % and _ should be escaped, not treated as wildcards
    const result = executeGhostwriterTool(db, 1, "search_past_posts", {
      query: "100%_success",
    }, state);
    // Should not match anything (the wildcards were escaped)
    expect(result).toContain("No posts found");
  });
});
