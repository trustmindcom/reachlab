import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { initDatabase } from "../db/index.js";
import {
  ghostwriterTurn,
  buildFirstTurnPrompt,
  buildSubsequentTurnPrompt,
  MAX_TOOL_ITERATIONS,
  MAX_TURN_INPUT_TOKENS,
} from "../ai/ghostwriter.js";
import { mockClient, textResponse, toolUseResponse } from "./helpers/mock-client.js";
import { AiLogger } from "../ai/logger.js";
import { createRun } from "../db/ai-queries.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-ghostwriter.db");

let db: Database.Database;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);

  // Seed minimal data for generation messages
  db.prepare(
    "INSERT INTO personas (id, name, linkedin_url, type) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING"
  ).run(1, "Test Persona", "https://www.linkedin.com/in/test", "personal");
});

afterAll(() => {
  db?.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

function makeLogger() {
  const runId = createRun(db, 1, "test", 0);
  return new AiLogger(db, runId);
}

// ── Prompt builder tests ─────────────────────────────────

describe("buildFirstTurnPrompt", () => {
  it("includes draft variations in the prompt", () => {
    const drafts = [
      { type: "contrarian" as const, hook: "Hook A", body: "Body A", closing: "Close A", word_count: 50, structure_label: "claim" },
      { type: "operator" as const, hook: "Hook B", body: "Body B", closing: "Close B", word_count: 60, structure_label: "story" },
    ];
    const prompt = buildFirstTurnPrompt(drafts, "Make it punchy", "**The headline**\nSummary here");
    expect(prompt).toContain("Hook A");
    expect(prompt).toContain("Hook B");
    expect(prompt).toContain("Body A");
    expect(prompt).toContain("Make it punchy");
    expect(prompt).toContain("**The headline**");
    expect(prompt).toContain("update_draft");
  });

  it("includes behavioral instructions", () => {
    const prompt = buildFirstTurnPrompt([], "", "");
    expect(prompt).toContain("ONE question at a time");
    expect(prompt).toContain("looks good");
    expect(prompt).toContain("SURFACE");
    expect(prompt).toContain("ENERGY");
  });

  it("handles empty feedback", () => {
    const prompt = buildFirstTurnPrompt([], "", "");
    expect(prompt).toContain("(No specific guidance)");
  });

  it("handles empty drafts", () => {
    const prompt = buildFirstTurnPrompt([], "Some feedback", "");
    expect(prompt).toContain("(No drafts provided)");
  });
});

describe("buildSubsequentTurnPrompt", () => {
  it("omits draft variations", () => {
    const prompt = buildSubsequentTurnPrompt("**Headline**\nContext");
    expect(prompt).not.toContain("Selected Drafts");
    expect(prompt).toContain("**Headline**");
    expect(prompt).toContain("update_draft");
  });

  it("includes behavioral instructions", () => {
    const prompt = buildSubsequentTurnPrompt("");
    expect(prompt).toContain("ONE question at a time");
    expect(prompt).toContain("Don't revert");
  });

  it("handles empty story context", () => {
    const prompt = buildSubsequentTurnPrompt("");
    expect(prompt).not.toContain("Story Context");
  });
});

// ── Agentic loop tests ───────────────────────────────────

describe("ghostwriterTurn", () => {
  it("terminates on end_turn and returns text", async () => {
    const client = mockClient([
      textResponse("Here is my response.", { input_tokens: 200, output_tokens: 80 }),
    ]);

    // Insert a generation for the message to reference
    db.prepare(
      "INSERT INTO generations (id, persona_id, post_type, status) VALUES (?, ?, ?, ?)"
    ).run(100, 1, "general", "draft");

    const result = await ghostwriterTurn(
      client, db, 1, 100, makeLogger(),
      [{ role: "user", content: "Hello" }],
      "System prompt",
      "Initial draft"
    );

    expect(result.assistantMessage).toBe("Here is my response.");
    expect(result.draft).toBeNull(); // no update_draft called
    expect(result.input_tokens).toBe(200);
    expect(result.output_tokens).toBe(80);
    expect(result.toolsUsed).toEqual([]);
  });

  it("executes tools and continues until end_turn", async () => {
    db.prepare(
      "INSERT OR IGNORE INTO generations (id, persona_id, post_type, status) VALUES (?, ?, ?, ?)"
    ).run(101, 1, "general", "draft");

    const client = mockClient([
      // First response: tool call
      toolUseResponse([
        {
          id: "tool_1",
          name: "update_draft",
          input: { draft: "Updated draft text here with enough content", change_summary: "Initial combination" },
        },
      ]),
      // Second response: end_turn
      textResponse("I combined the drafts. What do you think?"),
    ]);

    const result = await ghostwriterTurn(
      client, db, 1, 101, makeLogger(),
      [{ role: "user", content: "Combine these" }],
      "System prompt",
      "Original draft"
    );

    expect(result.assistantMessage).toBe("I combined the drafts. What do you think?");
    expect(result.draft).toBe("Updated draft text here with enough content");
    expect(result.changeSummary).toBe("Initial combination");
    expect(result.toolsUsed).toEqual(["update_draft"]);
  });

  it("stops at MAX_TOOL_ITERATIONS", async () => {
    db.prepare(
      "INSERT OR IGNORE INTO generations (id, persona_id, post_type, status) VALUES (?, ?, ?, ?)"
    ).run(102, 1, "general", "draft");

    // Create MAX_TOOL_ITERATIONS + 1 tool_use responses to exceed the cap
    const responses = Array.from({ length: MAX_TOOL_ITERATIONS + 1 }, (_, i) =>
      toolUseResponse([
        {
          id: `tool_${i}`,
          name: "get_platform_knowledge",
          input: { aspect: "hooks" },
        },
      ])
    );

    const client = mockClient(responses);

    await expect(
      ghostwriterTurn(
        client, db, 1, 102, makeLogger(),
        [{ role: "user", content: "Help" }],
        "System prompt",
        "Draft"
      )
    ).rejects.toThrow("exceeded maximum tool iterations");
  });

  it("stops at token budget", async () => {
    db.prepare(
      "INSERT OR IGNORE INTO generations (id, persona_id, post_type, status) VALUES (?, ?, ?, ?)"
    ).run(103, 1, "general", "draft");

    const client = mockClient([
      // First response uses enough tokens to exceed budget
      toolUseResponse(
        [{ id: "tool_1", name: "get_platform_knowledge", input: { aspect: "hooks" } }],
        { usage: { input_tokens: MAX_TURN_INPUT_TOKENS + 1, output_tokens: 50 } }
      ),
      // This should NOT be called because budget is exceeded before the call
      textResponse("Should not reach here"),
    ]);

    const result = await ghostwriterTurn(
      client, db, 1, 103, makeLogger(),
      [{ role: "user", content: "Help" }],
      "System prompt",
      "Draft"
    );

    // Loop should exit due to token budget, returning whatever text blocks exist
    // The last response was a tool_use with no text, so we get the fallback
    expect(result.assistantMessage).toBe("(Draft updated)");
    expect(result.input_tokens).toBe(MAX_TURN_INPUT_TOKENS + 1);
  });

  it("skips malformed tool_use blocks", async () => {
    db.prepare(
      "INSERT OR IGNORE INTO generations (id, persona_id, post_type, status) VALUES (?, ?, ?, ?)"
    ).run(104, 1, "general", "draft");

    // Response with a malformed tool block (empty id) mixed with valid
    const response: any = {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: "mock",
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "", name: "get_author_profile", input: {} }, // malformed: empty id
        { type: "tool_use", id: "tool_2", name: "get_platform_knowledge", input: { aspect: "hooks" } },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const client = mockClient([response, textResponse("Done.")]);

    const result = await ghostwriterTurn(
      client, db, 1, 104, makeLogger(),
      [{ role: "user", content: "Help" }],
      "System prompt",
      "Draft"
    );

    // Only the valid tool should be in toolsUsed
    expect(result.toolsUsed).toEqual(["get_platform_knowledge"]);
    expect(result.assistantMessage).toBe("Done.");
  });

  it("handles multiple tools in one response", async () => {
    db.prepare(
      "INSERT OR IGNORE INTO generations (id, persona_id, post_type, status) VALUES (?, ?, ?, ?)"
    ).run(105, 1, "general", "draft");

    const client = mockClient([
      toolUseResponse([
        { id: "tool_1", name: "get_author_profile", input: {} },
        { id: "tool_2", name: "lookup_rules", input: {} },
      ]),
      textResponse("Got the info."),
    ]);

    const result = await ghostwriterTurn(
      client, db, 1, 105, makeLogger(),
      [{ role: "user", content: "Help" }],
      "System prompt",
      "Draft"
    );

    expect(result.toolsUsed).toEqual(["get_author_profile", "lookup_rules"]);
  });

  it("draft unchanged when update_draft not called", async () => {
    db.prepare(
      "INSERT OR IGNORE INTO generations (id, persona_id, post_type, status) VALUES (?, ?, ?, ?)"
    ).run(106, 1, "general", "draft");

    const client = mockClient([textResponse("Looks good to me!")]);

    const result = await ghostwriterTurn(
      client, db, 1, 106, makeLogger(),
      [{ role: "user", content: "Ship it" }],
      "System prompt",
      "My draft"
    );

    expect(result.draft).toBeNull();
    expect(result.changeSummary).toBeNull();
  });

  it("token accounting sums across iterations", async () => {
    db.prepare(
      "INSERT OR IGNORE INTO generations (id, persona_id, post_type, status) VALUES (?, ?, ?, ?)"
    ).run(107, 1, "general", "draft");

    const client = mockClient([
      toolUseResponse(
        [{ id: "tool_1", name: "get_author_profile", input: {} }],
        { usage: { input_tokens: 150, output_tokens: 30 } }
      ),
      textResponse("Done.", { input_tokens: 200, output_tokens: 40 }),
    ]);

    const result = await ghostwriterTurn(
      client, db, 1, 107, makeLogger(),
      [{ role: "user", content: "Help" }],
      "System prompt",
      "Draft"
    );

    expect(result.input_tokens).toBe(350);
    expect(result.output_tokens).toBe(70);
  });
});
