import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  getResearch,
  getGeneration,
  updateGeneration,
  listGenerations,
  type Story,
  type Draft,
} from "../db/generate-queries.js";
import { getPersonaId } from "../utils.js";
import { createPersonaGuard } from "../middleware/persona-guard.js";

export function registerHistoryRoutes(app: FastifyInstance, db: Database.Database): void {
  const personaGuard = createPersonaGuard(db);

  // ── History ──────────────────────────────────────────────

  app.get("/api/generate/history", async (request) => {
    const personaId = getPersonaId(request);
    const q = request.query as { status?: string; offset?: string; limit?: string };
    const result = listGenerations(db, personaId, {
      status: q.status,
      offset: q.offset ? Number(q.offset) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });

    const summaries = result.generations.map((g) => {
      const drafts: Draft[] = g.drafts_json ? JSON.parse(g.drafts_json) : [];
      const hookExcerpt = g.final_draft
        ? g.final_draft.substring(0, 80) + (g.final_draft.length > 80 ? "..." : "")
        : drafts[0]?.hook?.substring(0, 80) ?? "";

      // Get story headline from research record
      let storyHeadline = "";
      if (g.research_id && g.selected_story_index !== null) {
        const research = getResearch(db, g.research_id);
        if (research) {
          const stories: Story[] = JSON.parse(research.stories_json);
          storyHeadline = stories[g.selected_story_index]?.headline ?? "";
        }
      }

      return {
        id: g.id,
        hook_excerpt: hookExcerpt,
        story_headline: storyHeadline,
        post_type: g.post_type,
        status: g.status,
        drafts_used: g.selected_draft_indices ? JSON.parse(g.selected_draft_indices).length : 0,
        created_at: g.created_at,
      };
    });

    return { generations: summaries, total: result.total };
  });

  app.get("/api/generate/history/:id", { preHandler: personaGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const gen = getGeneration(db, Number(id));
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }
    // Enrich with research stories
    let stories: any[] = [];
    let articleCount = 0;
    let sourceCount = 0;
    if (gen.research_id) {
      const research = getResearch(db, gen.research_id);
      if (research) {
        stories = JSON.parse(research.stories_json);
        articleCount = research.article_count ?? 0;
        sourceCount = research.source_count ?? 0;
      }
    }
    return { ...gen, stories, article_count: articleCount, source_count: sourceCount };
  });

  app.post("/api/generate/history/:id/discard", { preHandler: personaGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const gen = getGeneration(db, Number(id));
    if (!gen) return reply.status(404).send({ error: "Generation not found" });
    updateGeneration(db, Number(id), { status: "discarded" });
    return { ok: true };
  });

  app.delete("/api/generate/history/:id", { preHandler: personaGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const gen = getGeneration(db, Number(id));
    if (!gen) return reply.status(404).send({ error: "Generation not found" });
    db.prepare("DELETE FROM generation_messages WHERE generation_id = ?").run(Number(id));
    db.prepare("DELETE FROM generations WHERE id = ?").run(Number(id));
    return { ok: true };
  });
}
