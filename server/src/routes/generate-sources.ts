import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { createDbClient } from "../db/client.js";
import { listSources, sourceExists, insertSource, getSource, updateSource, deleteSource, getTaxonomyNames, deleteSources, DEFAULT_FEED_URLS } from "../db/source-queries.js";
import { createRun, completeRun, failRun, getRunCost, getPersonaSetting, upsertPersonaSetting } from "../db/ai-queries.js";
import { createClient } from "../ai/client.js";
import { AiLogger } from "../ai/logger.js";
import { discoverTopics } from "../ai/discovery.js";
import { discoverFeeds, discoverFeedsByGuessing, validateFeedUrl } from "../ai/feed-discoverer.js";
import { getPersonaId } from "../utils.js";
import { validateBody } from "../validation.js";
import { sourceUrlBody, sourceUpdateBody, sourceDiscoverBody } from "../schemas/generate.js";

export function registerSourceRoutes(app: FastifyInstance, db: Database.Database): void {
  const dbc = createDbClient(db);
  // ── Discovery ──────────────────────────────────────────────

  app.post("/api/generate/discover", async (request, reply) => {
    const personaId = getPersonaId(request);
    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required");
    const client = createClient(apiKey);
    const runId = createRun(db, personaId, "generate_discover", 0);
    const logger = new AiLogger(db, runId);

    try {
      // Pass previously discovered topics so the LLM avoids repeating them
      const prevRaw = getPersonaSetting(db, personaId, "last_discovery_labels");
      const previousLabels = prevRaw ? JSON.parse(prevRaw) as string[] : [];

      const result = await discoverTopics(client, db, personaId, logger, previousLabels);

      // Store this round's labels for next time
      const allLabels = result.topics.map(t => t.label);
      upsertPersonaSetting(db, personaId, "last_discovery_labels", JSON.stringify(allLabels));

      completeRun(db, runId, getRunCost(db, runId));

      return result;
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Sources management ─────────────────────────────────

  app.get("/api/sources", async (request) => {
    const personaId = getPersonaId(request);
    return { sources: listSources(dbc, personaId) };
  });

  app.post("/api/sources", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { url } = validateBody(sourceUrlBody, request.body);

    const trimmedUrl = url.trim();

    // If the user pasted a direct feed URL, validate it straight away so we
    // return a clear error instead of falling through to site discovery.
    if (/\/(feed|rss|atom)(\.xml)?\/?$|\.xml$/i.test(trimmedUrl)) {
      const direct = await validateFeedUrl(trimmedUrl);
      if (!direct.valid) {
        return reply.status(400).send({ error: `feed validation failed: ${direct.reason}` });
      }
    }

    // Auto-discover feeds from the URL (discoverers validate candidates internally)
    let feeds = await discoverFeeds(trimmedUrl);
    if (feeds.length === 0) {
      feeds = await discoverFeedsByGuessing(trimmedUrl);
    }
    if (feeds.length === 0) {
      return reply.status(404).send({ error: "No feed found at that URL. Try a blog, newsletter, or news site." });
    }

    // Use the first discovered (and already-validated) feed
    const feed = feeds[0];

    // Check for duplicate within this persona
    if (sourceExists(dbc, feed.feed_url, personaId)) {
      return reply.status(409).send({ error: "This source is already added." });
    }

    const sourceId = insertSource(dbc, feed.title, feed.feed_url, personaId);

    return {
      source: {
        id: sourceId,
        name: feed.title,
        feed_url: feed.feed_url,
        enabled: 1,
      },
    };
  });

  app.patch("/api/sources/:id", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { id } = request.params as { id: string };
    const { enabled, name } = validateBody(sourceUpdateBody, request.body);

    if (!getSource(dbc, Number(id), personaId)) {
      return reply.status(404).send({ error: "Source not found" });
    }

    updateSource(dbc, Number(id), personaId, { enabled, name });

    return { ok: true };
  });

  app.delete("/api/sources/:id", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { id } = request.params as { id: string };
    if (!deleteSource(dbc, Number(id), personaId)) {
      return reply.status(404).send({ error: "Source not found" });
    }
    return { ok: true };
  });

  // ── Source Discovery ─────────────────────────────────────

  app.post("/api/sources/discover", async (request) => {
    const personaId = getPersonaId(request);
    const { topics } = validateBody(sourceDiscoverBody, request.body);

    // Prefer author profile topics (from voice interview) over taxonomy
    let topicList: string[] = topics ?? [];
    if (!topicList || topicList.length === 0) {
      const { getAuthorProfile } = await import("../db/profile-queries.js");
      const profile = getAuthorProfile(db, personaId);
      if (profile?.profile_json) {
        try {
          const parsed = JSON.parse(profile.profile_json);
          if (Array.isArray(parsed.writing_topics) && parsed.writing_topics.length > 0) {
            topicList = parsed.writing_topics;
          }
        } catch { /* ignore parse errors */ }
      }
    }

    // Fall back to taxonomy topics if no author profile
    if (topicList.length === 0) {
      topicList = getTaxonomyNames(dbc);
    }

    if (topicList.length === 0) {
      return { sources: [] };
    }

    const { discoverSources } = await import("../ai/source-discoverer.js");
    const sources = await discoverSources(topicList);
    return { sources };
  });

  // ── Source Backfill ─────────────────────────────────────
  // Discovers sources based on author profile topics, removes seed defaults,
  // and saves the discovered sources. For existing users who onboarded before
  // source discovery was wired to the interview.

  app.post("/api/sources/backfill", async (request) => {
    const personaId = getPersonaId(request);

    // 1. Get writing_topics from author profile
    const { getAuthorProfile } = await import("../db/profile-queries.js");
    const profile = getAuthorProfile(db, personaId);
    let topics: string[] = [];
    if (profile?.profile_json) {
      try {
        const parsed = JSON.parse(profile.profile_json);
        if (Array.isArray(parsed.writing_topics)) {
          topics = parsed.writing_topics;
        }
      } catch { /* ignore */ }
    }

    if (topics.length === 0) {
      return { sources: [], removed: 0, added: 0, message: "No writing topics found in your profile. Complete a voice interview first." };
    }

    // 2. Discover sources via Perplexity
    const { discoverSources } = await import("../ai/source-discoverer.js");
    const discovered = await discoverSources(topics);
    const withFeeds = discovered.filter((s) => s.feed_url);

    if (withFeeds.length === 0) {
      return { sources: [], removed: 0, added: 0, message: "Couldn't find sources with RSS feeds for your topics." };
    }

    // 3. Remove default seed sources (only those that match the known defaults)
    const existing = listSources(dbc, personaId);
    const defaultIds = existing
      .filter((s) => DEFAULT_FEED_URLS.has(s.feed_url))
      .map((s) => s.id);
    const removed = deleteSources(dbc, defaultIds, personaId);

    // 4. Add discovered sources (skip duplicates)
    let added = 0;
    for (const source of withFeeds) {
      if (!sourceExists(dbc, source.feed_url!, personaId)) {
        insertSource(dbc, source.name, source.feed_url!, personaId);
        added++;
      }
    }

    return { sources: withFeeds, removed, added };
  });
}
