import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createCoachSession,
  getCoachSession,
  listCoachSessions,
  insertCoachMessage,
  getCoachMessages,
} from "../db/coach-chat-queries.js";
import { createRun, completeRun, failRun, getRunCost } from "../db/ai-queries.js";
import { createClient } from "../ai/client.js";
import { AiLogger } from "../ai/logger.js";
import { coachChatTurn } from "../ai/coach-chat.js";
import { expandMessageRow } from "../ai/agent-loop.js";
import { getPersonaId } from "../utils.js";
import { validateBody } from "../validation.js";
import { coachChatBody, createSessionBody } from "../schemas/coach-chat.js";
import { createCoachSessionGuard } from "../middleware/persona-guard.js";

function getClient(): Anthropic {
  const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
  if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required");
  return createClient(apiKey);
}

export function registerCoachChatRoutes(app: FastifyInstance, db: Database.Database): void {
  const coachSessionGuard = createCoachSessionGuard(db);
  const activeRequests = new Set<number>();

  // ── Send message ────────────────────────────────────────

  app.post("/api/coach/chat", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { session_id, message } = validateBody(coachChatBody, request.body);

    // Create session on first message if needed
    let sessionId: number;
    if (session_id === null) {
      sessionId = createCoachSession(db, personaId);
    } else {
      const session = getCoachSession(db, session_id);
      if (!session) return reply.status(404).send({ error: "Session not found" });
      if (session.persona_id !== personaId) return reply.status(403).send({ error: "Not authorized" });
      sessionId = session_id;
    }

    // Concurrent request guard
    if (activeRequests.has(sessionId)) {
      return reply.status(429).send({ error: "Request already in progress" });
    }
    activeRequests.add(sessionId);

    const client = getClient();
    const runId = createRun(db, personaId, "coach_chat", 0);
    const logger = new AiLogger(db, runId);

    try {
      // Persist user message BEFORE calling coachChatTurn
      insertCoachMessage(db, { session_id: sessionId, role: "user", content: message });

      // Load history and replay with microcompaction
      const history = getCoachMessages(db, sessionId, 20).reverse();
      const recentThreshold = Math.max(0, history.length - 10);
      const messages: Array<{ role: "user" | "assistant"; content: any }> = [];
      for (let i = 0; i < history.length; i++) {
        const isRecent = i >= recentThreshold;
        const expanded = expandMessageRow(history[i], isRecent);
        messages.push(...expanded);
      }

      const result = await coachChatTurn(client, db, personaId, sessionId, logger, messages);

      completeRun(db, runId, getRunCost(db, runId));

      return {
        session_id: sessionId,
        message: result.assistantMessage,
        tools_used: result.toolsUsed,
      };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    } finally {
      activeRequests.delete(sessionId);
    }
  });

  // ── List sessions ──────────────────────────────────────

  app.get("/api/coach/chat/sessions", async (request) => {
    const personaId = getPersonaId(request);
    const sessions = listCoachSessions(db, personaId);
    return { sessions };
  });

  // ── Create empty session ───────────────────────────────

  app.post("/api/coach/chat/sessions", async (request) => {
    const personaId = getPersonaId(request);
    const { title } = validateBody(createSessionBody, request.body);
    const id = createCoachSession(db, personaId, title);
    return { session_id: id };
  });

  // ── Get messages for a session ─────────────────────────

  app.get("/api/coach/chat/sessions/:id/messages", { preHandler: coachSessionGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const sessionId = parseInt(id, 10);
    if (isNaN(sessionId)) return reply.status(400).send({ error: "Invalid session id" });

    const session = getCoachSession(db, sessionId);
    if (!session) return reply.status(404).send({ error: "Session not found" });

    const messages = getCoachMessages(db, sessionId, 50).reverse();
    return { messages };
  });
}
