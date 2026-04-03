import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  getGeneration,
  updateGeneration,
  getRules,
  startRetro,
  completeRetro,
  getRetroResult,
  getPendingRetros,
  markRetroApplied,
} from "../db/generate-queries.js";
import { createRun, completeRun, failRun, getRunCost, getPersonaSetting } from "../db/ai-queries.js";
import { createClient } from "../ai/client.js";
import { analyzeRetro } from "../ai/retro.js";
import { getPersonaId } from "../utils.js";
import { validateBody } from "../validation.js";
import { retroBody } from "../schemas/generate.js";
import { createPersonaGuard } from "../middleware/persona-guard.js";

export function registerRetroRoutes(app: FastifyInstance, db: Database.Database): void {
  const personaGuard = createPersonaGuard(db);

  // ── Retro: compare draft vs published ───────────────────

  app.post("/api/generate/history/:id/retro", { preHandler: personaGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validateBody(retroBody, request.body);
    if (!body.published_text?.trim()) {
      return reply.status(400).send({ error: "published_text is required" });
    }

    const gen = getGeneration(db, Number(id));
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }
    if (!gen.final_draft) {
      return reply.status(400).send({ error: "Generation has no final draft to compare against" });
    }

    const personaId = getPersonaId(request);
    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required");
    const client = createClient(apiKey);

    // Get existing rules for context
    const rules = getRules(db, personaId);
    const ruleTexts = rules.filter(r => r.enabled).map(r => r.rule_text);

    // Get current writing prompt so the LLM can suggest specific edits
    const writingPromptValue = getPersonaSetting(db, personaId, "writing_prompt");

    // Mark as in-progress so the UI can show a spinner and recover if user navigates away
    startRetro(db, Number(id), body.published_text.trim());

    let analysis;
    let input_tokens: number;
    let output_tokens: number;
    try {
      const result = await analyzeRetro(
        client, gen.final_draft, body.published_text.trim(), ruleTexts, writingPromptValue ?? undefined
      );
      analysis = result.analysis;
      input_tokens = result.input_tokens;
      output_tokens = result.output_tokens;
    } catch (err: any) {
      console.error(`[Retro] Analysis failed for generation ${id}:`, err.message ?? err);
      if (err.status) console.error(`[Retro] HTTP status: ${err.status}`);
      if (err.error) console.error(`[Retro] Error body:`, JSON.stringify(err.error));
      return reply.status(502).send({
        error: "AI analysis failed",
        detail: err.message ?? "Unknown error",
      });
    }

    // Store the published text and analysis
    completeRetro(db, Number(id), JSON.stringify(analysis));

    // Update status to published
    updateGeneration(db, Number(id), { status: "published" });

    // Fire-and-forget: store retro patterns as editorial principles
    import("../ai/retro.js").then(({ storeRetroAsPrinciples }) =>
      storeRetroAsPrinciples(client, db, personaId, analysis, gen.post_type)
        .catch(err => console.error("[Retro] Failed to store principles:", err))
    );

    return { analysis, input_tokens, output_tokens };
  });

  // Get retro results for a generation
  app.get("/api/generate/history/:id/retro", { preHandler: personaGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const gen = getGeneration(db, Number(id));
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }
    const row = getRetroResult(db, Number(id));

    if (!row?.retro_json) {
      return { retro: null };
    }
    return {
      retro: {
        published_text: row.published_text,
        analysis: JSON.parse(row.retro_json),
        retro_at: row.retro_at,
      }
    };
  });

  // ── Pending Retros (for Coach page) ─────────────────────

  app.get("/api/generate/retros/pending", async (request) => {
    const personaId = getPersonaId(request);
    const rows = getPendingRetros(db, personaId);

    return {
      retros: rows.map((r) => ({
        generation_id: r.id,
        draft_excerpt: (r.final_draft ?? "").split("\n").slice(0, 3).join("\n"),
        retro_at: r.retro_at,
        matched_post_id: r.matched_post_id,
        analysis: JSON.parse(r.retro_json),
      })),
    };
  });

  app.patch("/api/generate/retros/:id/apply", { preHandler: personaGuard }, async (request) => {
    const { id } = request.params as { id: string };
    markRetroApplied(db, Number(id));
    return { ok: true };
  });
}
