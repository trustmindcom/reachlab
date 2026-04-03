import type { FastifyRequest, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { getPersonaId } from "../utils.js";

/**
 * Fastify preHandler that checks persona ownership for generation routes with :id params.
 * If the resource exists but belongs to a different persona, returns 403.
 * If the resource doesn't exist, lets the route handler return 404.
 */
export function createPersonaGuard(db: Database.Database) {
  return async function personaGuard(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as Record<string, string>;
    const id = params?.id;
    if (!id) return;

    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1) return;

    const gen = db.prepare("SELECT persona_id FROM generations WHERE id = ?").get(numId) as { persona_id: number } | undefined;
    if (!gen) return; // Let the route handler return 404

    const personaId = getPersonaId(request);
    if (gen.persona_id !== personaId) {
      return reply.status(403).send({ error: "Not authorized" });
    }
  };
}

/**
 * Fastify preHandler that checks persona ownership for coach chat session routes with :id params.
 */
export function createCoachSessionGuard(db: Database.Database) {
  return async function coachSessionGuard(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as Record<string, string>;
    const id = params?.id;
    if (!id) return;

    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1) return;

    const session = db.prepare("SELECT persona_id FROM coach_chat_sessions WHERE id = ?").get(numId) as { persona_id: number } | undefined;
    if (!session) return;

    const personaId = getPersonaId(request);
    if (session.persona_id !== personaId) {
      return reply.status(403).send({ error: "Not authorized" });
    }
  };
}
