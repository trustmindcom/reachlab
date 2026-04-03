import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import {
  insertResearch,
  getResearch,
  insertGeneration,
  getGeneration,
  updateGeneration,
  getRules,
  replaceAllRules,
  seedDefaultRules,
  getActiveCoachingInsights,
  insertTopicLog,
  getAntiAiTropesEnabled,
  getActiveGeneration,
  insertGenerationMessage,
  getGenerationMessages,
  getRuleCount,
  getMaxRuleSortOrder,
  insertSingleRule,
  type Story,
  type Draft,
} from "../db/generate-queries.js";
import { createRun, completeRun, failRun, getRunCost } from "../db/ai-queries.js";
import { streamWithIdleTimeout } from "../ai/stream-with-idle.js";
import { createClient, MODELS } from "../ai/client.js";
import { AiLogger } from "../ai/logger.js";
import { researchStories } from "../ai/researcher.js";
import { generateDrafts, reviseDrafts } from "../ai/drafter.js";
import { combineDrafts } from "../ai/combiner.js";
import { coachCheck } from "../ai/coach-check.js";
import { registerCoachingRoutes } from "./generate-coaching.js";
import { registerHistoryRoutes } from "./generate-history.js";
import { registerRetroRoutes } from "./generate-retro.js";
import { registerSourceRoutes } from "./generate-sources.js";
import { getPersonaId } from "../utils.js";
import { validateBody } from "../validation.js";
import { researchBody, draftsBody, reviseDraftsBody, combineBody, chatBody, rulesBody, addRuleBody, ghostwriteBody, selectionBody, draftSaveBody } from "../schemas/generate.js";
import { ghostwriterTurn, buildFirstTurnPrompt, buildSubsequentTurnPrompt, expandMessageRow } from "../ai/ghostwriter.js";
import { createPersonaGuard } from "../middleware/persona-guard.js";

function getClient(): Anthropic {
  const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
  if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required");
  return createClient(apiKey);
}

export function registerGenerateRoutes(app: FastifyInstance, db: Database.Database): void {
  const personaGuard = createPersonaGuard(db);

  // Seed default rules for persona 1 if none exist (first run)
  if (getRuleCount(db, 1) === 0) {
    seedDefaultRules(db, 1);
  }

  // ── Research ─────────────────────────────────────────────

  app.post("/api/generate/research", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { topic, avoid, source_context } = validateBody(researchBody, request.body);
    const safeAvoid = Array.isArray(avoid) ? avoid.slice(0, 50).map((s) => String(s).slice(0, 200)) : undefined;

    const client = getClient();
    const runId = createRun(db, personaId, "generate_research", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await researchStories(client, db, logger, topic, safeAvoid, source_context);

      const researchId = insertResearch(db, personaId, {
        post_type: "general",
        topic,
        stories_json: JSON.stringify(result.stories),
        sources_json: JSON.stringify(result.sources_metadata),
        article_count: result.article_count,
        source_count: result.source_count,
      });

      completeRun(db, runId, getRunCost(db, runId));

      return {
        research_id: researchId,
        stories: result.stories,
        article_count: result.article_count,
        source_count: result.source_count,
      };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Drafts ───────────────────────────────────────────────

  app.post("/api/generate/drafts", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { research_id, story_index, personal_connection, length } = validateBody(draftsBody, request.body);

    const research = getResearch(db, research_id);
    if (!research) {
      return reply.status(404).send({ error: "Research not found" });
    }

    const stories: Story[] = JSON.parse(research.stories_json);
    if (story_index < 0 || story_index >= stories.length) {
      return reply.status(400).send({ error: "Invalid story_index" });
    }

    const client = getClient();
    const runId = createRun(db, personaId, "generate_drafts", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await generateDrafts(
        client,
        db,
        personaId,
        logger,
        stories[story_index],
        personal_connection,
        length
      );

      const generationId = insertGeneration(db, personaId, {
        research_id,
        post_type: "general",
        selected_story_index: story_index,
        drafts_json: JSON.stringify(result.drafts),
        prompt_snapshot: result.prompt_snapshot,
        personal_connection,
        draft_length: length,
      });

      // Log topic for anti-narrowing
      insertTopicLog(db, {
        generation_id: generationId,
        topic_category: stories[story_index].tag,
        was_stretch: stories[story_index].is_stretch,
      });

      completeRun(db, runId, getRunCost(db, runId));

      return { generation_id: generationId, drafts: result.drafts };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Revise Drafts ────────────────────────────────────────

  app.post("/api/generate/revise-drafts", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { generation_id, feedback } = validateBody(reviseDraftsBody, request.body);

    const generation = getGeneration(db, generation_id);
    if (!generation) {
      return reply.status(404).send({ error: "Generation not found" });
    }

    const currentDrafts: Draft[] = JSON.parse(generation.drafts_json!);
    const client = getClient();
    const runId = createRun(db, personaId, "revise_drafts", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await reviseDrafts(
        client, db, personaId, logger,
        currentDrafts, feedback,
        (generation as any).draft_length
      );

      updateGeneration(db, generation_id, {
        drafts_json: JSON.stringify(result.drafts),
      });

      completeRun(db, runId, getRunCost(db, runId));

      return { drafts: result.drafts };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Combine ──────────────────────────────────────────────

  app.post("/api/generate/combine", async (request, reply) => {
    const { generation_id, selected_drafts, combining_guidance } = validateBody(combineBody, request.body);

    const gen = getGeneration(db, generation_id);
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }

    const drafts: Draft[] = gen.drafts_json ? JSON.parse(gen.drafts_json) : [];
    if (drafts.length === 0) {
      return reply.status(400).send({ error: "No drafts available" });
    }

    const invalidIndex = selected_drafts.find((i) => i < 0 || i >= drafts.length);
    if (invalidIndex !== undefined) {
      return reply.status(400).send({ error: `Invalid draft index: ${invalidIndex}` });
    }

    const personaId = getPersonaId(request);
    const client = getClient();
    const runId = createRun(db, personaId, "generate_combine", 0);
    const logger = new AiLogger(db, runId);

    try {
      const validLengths = new Set(["short", "medium", "long"]);
      const draftLength = gen.draft_length && validLengths.has(gen.draft_length)
        ? (gen.draft_length as import("../ai/drafter.js").DraftLength)
        : undefined;
      const combineResult = await combineDrafts(client, logger, drafts, selected_drafts, combining_guidance, gen.prompt_snapshot ?? undefined, draftLength);

      // Run coach-check
      const rules = getRules(db, personaId);
      const insights = getActiveCoachingInsights(db, personaId);
      const coachResult = await coachCheck(client, logger, combineResult.final_draft, rules, insights);
      const qualityData = {
        expertise_needed: coachResult.expertise_needed,
        alignment: coachResult.alignment,
      };

      const genUpdate: Parameters<typeof updateGeneration>[2] = {
        selected_draft_indices: JSON.stringify(selected_drafts),
        final_draft: coachResult.draft,
        quality_gate_json: JSON.stringify(qualityData),
      };
      if (combining_guidance !== undefined) {
        genUpdate.combining_guidance = combining_guidance;
      }
      updateGeneration(db, generation_id, genUpdate);

      completeRun(db, runId, getRunCost(db, runId));

      return { final_draft: coachResult.draft, quality: qualityData };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Chat (replaces Revise) ───────────────────────────────

  app.post("/api/generate/chat", async (request, reply) => {
    const { generation_id, message, edited_draft } = validateBody(chatBody, request.body);

    const gen = getGeneration(db, generation_id);
    if (!gen?.final_draft) {
      return reply.status(404).send({ error: "Generation not found or no final draft" });
    }

    const personaId = getPersonaId(request);

    // Persona ownership check
    if (gen.persona_id !== personaId) {
      return reply.status(403).send({ error: "Not authorized" });
    }
    const client = getClient();
    const runId = createRun(db, personaId, "generate_chat", 0);
    const logger = new AiLogger(db, runId);

    try {
      const history = getGenerationMessages(db, generation_id, 20).reverse();

      const rules = getRules(db, personaId);
      const insights = getActiveCoachingInsights(db, personaId);
      const rulesText = rules.filter((r) => r.enabled).map((r) => `- [${r.category}] ${r.rule_text}`).join("\n");
      const insightsText = insights.map((i) => `- ${i.prompt_text}`).join("\n");

      const systemPrompt = `You are a LinkedIn post revision assistant. Make targeted changes based on user feedback — do not full-rewrite unless asked.

## Writing Rules
${rulesText}

## Coaching Insights
${insightsText}

When the user gives framing/perspective feedback, apply it and briefly explain what changed. If the user's feedback is ambiguous, ask one clarifying question before rewriting.

Return JSON only:
{
  "draft": "the full revised draft",
  "explanation": "1-2 sentences explaining what changed and why"
}`;

      const currentDraft = edited_draft ?? gen.final_draft;
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

      for (const msg of history) {
        messages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }

      const userContent = `## Current Draft\n${currentDraft}\n\n## Instruction\n${message.trim()}`;
      messages.push({ role: "user", content: userContent });

      const start = Date.now();
      const { text, input_tokens, output_tokens, thinking_tokens } = await streamWithIdleTimeout(client, {
        model: MODELS.SONNET,
        max_tokens: 4000,
        system: systemPrompt,
        messages,
      });

      const duration = Date.now() - start;

      logger.log({
        step: "chat_revision",
        model: MODELS.SONNET,
        input_messages: JSON.stringify(messages.slice(-1)),
        output_text: text,
        tool_calls: null,
        input_tokens,
        output_tokens,
        thinking_tokens,
        duration_ms: duration,
      });

      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      let revisedDraft = currentDraft;
      let explanation = "";

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          revisedDraft = parsed.draft ?? currentDraft;
          explanation = parsed.explanation ?? "";
        } catch {
          revisedDraft = text.trim();
        }
      } else {
        revisedDraft = text.trim();
      }

      const coachResult = await coachCheck(client, logger, revisedDraft, rules, insights);
      const qualityData = {
        expertise_needed: coachResult.expertise_needed,
        alignment: coachResult.alignment,
      };

      insertGenerationMessage(db, {
        generation_id,
        role: "user",
        content: userContent,
      });
      insertGenerationMessage(db, {
        generation_id,
        role: "assistant",
        content: text,
        draft_snapshot: coachResult.draft,
        quality_json: JSON.stringify(qualityData),
      });

      updateGeneration(db, generation_id, {
        final_draft: coachResult.draft,
        quality_gate_json: JSON.stringify(qualityData),
      });

      completeRun(db, runId, getRunCost(db, runId));

      return {
        draft: coachResult.draft,
        quality: qualityData,
        explanation,
      };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  app.get("/api/generate/:id/messages", { preHandler: personaGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const genId = parseInt(id, 10);
    if (isNaN(genId)) return reply.status(400).send({ error: "Invalid id" });

    const messages = getGenerationMessages(db, genId, 20).reverse();

    return messages.map((msg) => {
      if (msg.role === "user") {
        const instrMatch = msg.content.match(/## Instruction\n([\s\S]+)$/);
        return { ...msg, display_content: instrMatch ? instrMatch[1].trim() : msg.content };
      }
      if (msg.role === "assistant") {
        let explanation = msg.content;
        try {
          const cleaned = msg.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            explanation = parsed.explanation ?? msg.content;
          }
        } catch { /* use raw content */ }
        return { ...msg, display_content: explanation };
      }
      return { ...msg, display_content: msg.content };
    });
  });

  // ── Selection (persist draft picks) ──────────────────────

  app.patch("/api/generate/:id/selection", { preHandler: personaGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const genId = parseInt(id, 10);
    if (isNaN(genId)) return reply.status(400).send({ error: "Invalid id" });

    const gen = getGeneration(db, genId);
    if (!gen) return reply.status(404).send({ error: "Generation not found" });

    const { selected_draft_indices, combining_guidance } = validateBody(selectionBody, request.body);
    const updates: Parameters<typeof updateGeneration>[2] = {
      selected_draft_indices: JSON.stringify(selected_draft_indices),
    };
    if (combining_guidance !== undefined) {
      updates.combining_guidance = combining_guidance;
    }
    updateGeneration(db, genId, updates);
    return { ok: true };
  });

  // ── Draft auto-save ─────────────────────────────────────

  app.patch("/api/generate/:id/draft", { preHandler: personaGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const genId = parseInt(id, 10);
    if (isNaN(genId)) return reply.status(400).send({ error: "Invalid id" });

    const gen = getGeneration(db, genId);
    if (!gen) return reply.status(404).send({ error: "Generation not found" });

    const { draft } = validateBody(draftSaveBody, request.body);
    updateGeneration(db, genId, { final_draft: draft });
    return { ok: true };
  });

  // ── Ghostwriter chat ───────────────────────────────────

  const activeGhostwriteRequests = new Set<number>();

  app.post("/api/generate/ghostwrite", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { generation_id, message, current_draft } = validateBody(ghostwriteBody, request.body);

    // GUARD: generation exists
    const gen = getGeneration(db, generation_id);
    if (!gen) return reply.status(404).send({ error: "Generation not found" });

    // GUARD: persona ownership
    if (gen.persona_id !== personaId) {
      return reply.status(403).send({ error: "Not authorized" });
    }

    // GUARD: concurrent request lock
    if (activeGhostwriteRequests.has(generation_id)) {
      return reply.status(429).send({ error: "Request already in progress" });
    }
    activeGhostwriteRequests.add(generation_id);

    const client = getClient();
    const runId = createRun(db, personaId, "ghostwriter", 0);
    const logger = new AiLogger(db, runId);

    try {
      // Load history — consistent limit (20, matching restore)
      const history = getGenerationMessages(db, generation_id, 20).reverse();

      // Replay with microcompaction — last 5 turns get full tool context
      const recentThreshold = Math.max(0, history.length - 10);
      const messages: Array<{ role: "user" | "assistant"; content: any }> = [];
      for (let i = 0; i < history.length; i++) {
        const isRecent = i >= recentThreshold;
        const expanded = expandMessageRow(history[i], isRecent);
        messages.push(...expanded);
      }

      // Build system prompt — simplified after first turn
      const isFirstTurn = history.length === 0;
      const drafts: Draft[] = gen.drafts_json ? JSON.parse(gen.drafts_json) : [];
      const selectedIndices: number[] = gen.selected_draft_indices
        ? JSON.parse(gen.selected_draft_indices)
        : [];
      const selectedDrafts = selectedIndices.map((i) => drafts[i]).filter(Boolean);
      const research = gen.research_id ? getResearch(db, gen.research_id) : null;
      const stories: Story[] = research?.stories_json ? JSON.parse(research.stories_json) : [];
      const story = gen.selected_story_index != null ? stories[gen.selected_story_index] : null;
      const storyContext = story ? `**${story.headline}**\n${story.summary}` : "";

      const systemPrompt = isFirstTurn
        ? buildFirstTurnPrompt(
            selectedDrafts.length > 0 ? selectedDrafts : drafts,
            gen.combining_guidance ?? message,
            storyContext
          )
        : buildSubsequentTurnPrompt(storyContext);

      // Add user message to the messages array for the API call (NOT yet persisted)
      messages.push({ role: "user" as const, content: message });

      const activeDraft = current_draft ?? gen.final_draft ?? "";

      const result = await ghostwriterTurn(
        client,
        db,
        personaId,
        generation_id,
        logger,
        messages,
        systemPrompt,
        activeDraft
      );

      // Persist user message AFTER success (prevents orphaned messages on failure)
      insertGenerationMessage(db, { generation_id, role: "user", content: message });

      if (result.draft) {
        updateGeneration(db, generation_id, { final_draft: result.draft });
      }

      completeRun(db, runId, getRunCost(db, runId));

      return {
        message: result.assistantMessage,
        draft: result.draft,
        change_summary: result.changeSummary,
        tools_used: result.toolsUsed,
      };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    } finally {
      activeGhostwriteRequests.delete(generation_id);
    }
  });

  // ── Rules CRUD ───────────────────────────────────────────

  app.get("/api/generate/rules", async (request) => {
    const personaId = getPersonaId(request);
    const rules = getRules(db, personaId);
    const antiAiEnabled = getAntiAiTropesEnabled(db, personaId);

    const categories: Record<string, any> = {
      voice_tone: [] as any[],
      structure_formatting: [] as any[],
      anti_ai_tropes: { enabled: antiAiEnabled, rules: [] as any[] },
    };

    for (const rule of rules) {
      const item = { id: rule.id, rule_text: rule.rule_text, example_text: rule.example_text, sort_order: rule.sort_order, origin: rule.origin };
      if (rule.category === "anti_ai_tropes") {
        categories.anti_ai_tropes.rules.push(item);
      } else if (categories[rule.category]) {
        (categories[rule.category] as any[]).push(item);
      }
    }

    return { categories };
  });

  app.put("/api/generate/rules", async (request) => {
    const personaId = getPersonaId(request);
    const { categories } = validateBody(rulesBody, request.body);

    const allRules: Array<{ category: string; rule_text: string; example_text?: string; sort_order: number; enabled?: number }> = [];

    for (const rule of categories.voice_tone) {
      allRules.push({ category: "voice_tone", ...rule });
    }
    for (const rule of categories.structure_formatting) {
      allRules.push({ category: "structure_formatting", ...rule });
    }
    for (const rule of categories.anti_ai_tropes.rules) {
      allRules.push({ category: "anti_ai_tropes", ...rule, enabled: categories.anti_ai_tropes.enabled ? 1 : 0 });
    }

    replaceAllRules(db, personaId, allRules);
    return { ok: true };
  });

  app.post("/api/generate/rules/reset", async (request) => {
    const personaId = getPersonaId(request);
    seedDefaultRules(db, personaId);
    // Return the freshly-seeded rules in the same shape as GET
    const rules = getRules(db, personaId);
    const antiAiEnabled = getAntiAiTropesEnabled(db, personaId);
    const categories: Record<string, any> = {
      voice_tone: [] as any[],
      structure_formatting: [] as any[],
      anti_ai_tropes: { enabled: antiAiEnabled, rules: [] as any[] },
    };
    for (const rule of rules) {
      const item = { id: rule.id, rule_text: rule.rule_text, example_text: rule.example_text, sort_order: rule.sort_order, origin: rule.origin };
      if (rule.category === "anti_ai_tropes") {
        categories.anti_ai_tropes.rules.push(item);
      } else if (categories[rule.category]) {
        (categories[rule.category] as any[]).push(item);
      }
    }
    return { categories };
  });

  // Add a single rule (used by retro flow)
  app.post("/api/generate/rules/add", async (request, reply) => {
    const personaId = getPersonaId(request);
    const body = validateBody(addRuleBody, request.body);
    const validCategories = ["voice_tone", "structure_formatting", "anti_ai_tropes"];
    if (!validCategories.includes(body.category)) {
      return reply.status(400).send({ error: "Invalid category" });
    }
    const maxSort = getMaxRuleSortOrder(db, body.category, personaId);
    insertSingleRule(db, personaId, body.category, body.rule_text, maxSort + 1);
    return { ok: true };
  });

  // ── Active generation (auto-restore) ────────────────────

  app.get('/api/generate/active', async (request) => {
    const personaId = getPersonaId(request);
    const row = getActiveGeneration(db, personaId);
    if (!row) {
      return { generation: null };
    }
    // Enrich with research stories — same logic as history detail endpoint
    let stories: any[] = [];
    let articleCount = 0;
    let sourceCount = 0;
    if (row.research_id) {
      const research = getResearch(db, row.research_id);
      if (research) {
        try {
          stories = JSON.parse(research.stories_json);
        } catch {
          console.warn(`[Generate] Malformed stories_json for research ${row.research_id}`);
        }
        articleCount = research.article_count ?? 0;
        sourceCount = research.source_count ?? 0;
      }
    }
    return { generation: { ...row, stories, article_count: articleCount, source_count: sourceCount } };
  });

  // ── Extracted route modules ────────────────────────────────
  registerHistoryRoutes(app, db);
  registerRetroRoutes(app, db);
  registerCoachingRoutes(app, db);

  // ── Source & discovery routes (extracted) ──────────────────
  registerSourceRoutes(app, db);
}
