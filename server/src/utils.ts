import type { FastifyRequest } from "fastify";

/**
 * Extract personaId from route params, query string, or x-persona-id header.
 * Throws 400 if no valid persona ID is provided.
 */
export function getPersonaId(request: FastifyRequest): number {
  const params = request.params as any;
  if (params.personaId) {
    const n = parseInt(params.personaId, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const query = request.query as any;
  const raw = query.personaId ?? query.persona_id ?? (request.headers["x-persona-id"] as string);
  if (raw != null) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
  }
  throw Object.assign(new Error("Invalid or missing persona_id"), { statusCode: 400 });
}
