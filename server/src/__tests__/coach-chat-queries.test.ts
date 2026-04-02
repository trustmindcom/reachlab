import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  createCoachSession,
  getCoachSession,
  listCoachSessions,
  insertCoachMessage,
  getCoachMessages,
} from "../db/coach-chat-queries.js";
import { initDatabase } from "../db/index.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-coach-chat-queries.db");
const PERSONA_ID = 1;

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

describe("coach_chat_sessions", () => {
  it("creates and retrieves a session", () => {
    const sessionId = createCoachSession(db, PERSONA_ID, "My first coaching session");
    expect(sessionId).toBeGreaterThan(0);

    const session = getCoachSession(db, sessionId);
    expect(session).toBeDefined();
    expect(session!.persona_id).toBe(PERSONA_ID);
    expect(session!.title).toBe("My first coaching session");
    expect(session!.created_at).toBeDefined();
    expect(session!.updated_at).toBeDefined();
  });

  it("creates a session without a title", () => {
    const sessionId = createCoachSession(db, PERSONA_ID);
    const session = getCoachSession(db, sessionId);
    expect(session).toBeDefined();
    expect(session!.title).toBeNull();
  });

  it("returns undefined for non-existent session", () => {
    const session = getCoachSession(db, 999999);
    expect(session).toBeUndefined();
  });
});

describe("listCoachSessions", () => {
  it("lists sessions ordered by most recent updated_at", () => {
    const firstId = createCoachSession(db, PERSONA_ID, "Older session");
    // Manually set updated_at in the past so the ordering is unambiguous
    db.prepare("UPDATE coach_chat_sessions SET updated_at = datetime('now', '-10 minutes') WHERE id = ?").run(firstId);
    const secondId = createCoachSession(db, PERSONA_ID, "Newer session");

    const sessions = listCoachSessions(db, PERSONA_ID);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    // secondId (recently created) should appear before firstId (set to old)
    const secondIdx = sessions.findIndex((s) => s.id === secondId);
    const firstIdx = sessions.findIndex((s) => s.id === firstId);
    expect(secondIdx).toBeLessThan(firstIdx);
  });

  it("respects the limit parameter", () => {
    // Ensure there are at least 3 sessions
    createCoachSession(db, PERSONA_ID, "Extra session A");
    createCoachSession(db, PERSONA_ID, "Extra session B");
    createCoachSession(db, PERSONA_ID, "Extra session C");

    const sessions = listCoachSessions(db, PERSONA_ID, 2);
    expect(sessions.length).toBeLessThanOrEqual(2);
  });
});

describe("coach_chat_messages", () => {
  let sessionId: number;

  beforeAll(() => {
    sessionId = createCoachSession(db, PERSONA_ID, "Message test session");
  });

  it("inserts and retrieves messages", () => {
    const msgId = insertCoachMessage(db, {
      session_id: sessionId,
      role: "user",
      content: "What should I post about?",
    });
    expect(msgId).toBeGreaterThan(0);

    const assistantId = insertCoachMessage(db, {
      session_id: sessionId,
      role: "assistant",
      content: "Let me analyze your recent performance...",
    });
    expect(assistantId).toBeGreaterThan(msgId);

    const messages = getCoachMessages(db, sessionId);
    expect(messages).toHaveLength(2);
    // ORDER BY id DESC — most recent first
    expect(messages[0].role).toBe("assistant");
    expect(messages[1].role).toBe("user");
  });

  it("inserts and retrieves message with tool_blocks_json", () => {
    const toolBlocks = JSON.stringify([{ type: "tool_use", name: "get_posts", input: {} }]);
    const msgId = insertCoachMessage(db, {
      session_id: sessionId,
      role: "assistant",
      content: "I fetched your posts",
      tool_blocks_json: toolBlocks,
    });

    const messages = getCoachMessages(db, sessionId);
    const found = messages.find((m) => m.id === msgId);
    expect(found).toBeDefined();
    expect(found!.tool_blocks_json).toBe(toolBlocks);
  });

  it("messages without tools have null tool_blocks_json", () => {
    const msgId = insertCoachMessage(db, {
      session_id: sessionId,
      role: "user",
      content: "No tools in this one",
    });

    const messages = getCoachMessages(db, sessionId);
    const found = messages.find((m) => m.id === msgId);
    expect(found).toBeDefined();
    expect(found!.tool_blocks_json).toBeNull();
  });

  it("respects the message limit", () => {
    const limitSessionId = createCoachSession(db, PERSONA_ID, "Limit test session");
    for (let i = 0; i < 5; i++) {
      insertCoachMessage(db, { session_id: limitSessionId, role: "user", content: `Message ${i}` });
    }

    const messages = getCoachMessages(db, limitSessionId, 3);
    expect(messages.length).toBeLessThanOrEqual(3);
  });

  it("updates session updated_at when message is inserted", () => {
    const tsSessionId = createCoachSession(db, PERSONA_ID, "Timestamp test");
    // Set updated_at to a known past time
    db.prepare("UPDATE coach_chat_sessions SET updated_at = datetime('now', '-5 minutes') WHERE id = ?").run(tsSessionId);
    const before = (db.prepare("SELECT updated_at FROM coach_chat_sessions WHERE id = ?").get(tsSessionId) as any).updated_at;

    insertCoachMessage(db, { session_id: tsSessionId, role: "user", content: "bump" });

    const after = (db.prepare("SELECT updated_at FROM coach_chat_sessions WHERE id = ?").get(tsSessionId) as any).updated_at;
    expect(after).not.toBe(before);
  });
});
