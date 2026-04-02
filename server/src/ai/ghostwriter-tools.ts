import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import type Database from "better-sqlite3";
import { getAuthorProfile } from "../db/profile-queries.js";
import { getEditorialPrinciples } from "../db/generate-queries.js";
import { PLATFORM_KNOWLEDGE } from "./platform-knowledge.js";
import type { AiLogger } from "./logger.js";
import { SHARED_TOOLS, executeSharedTool } from "./shared-tools.js";

// ── Per-request state ──────────────────────────────────────

export interface GhostwriterState {
  currentDraft: string;
  lastChangeSummary: string;
}

export function createGhostwriterState(initialDraft: string): GhostwriterState {
  return { currentDraft: initialDraft, lastChangeSummary: "" };
}

// ── Tool definitions ───────────────────────────────────────

export const GHOSTWRITER_TOOLS: Tool[] = [
  ...SHARED_TOOLS,
  {
    name: "get_author_profile",
    description:
      "Retrieve the author's profile — their voice, expertise, audience, and writing style. Call this before drafting to match their tone.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "lookup_principles",
    description:
      "Look up editorial principles learned from past retros. Optionally filter by post type (e.g. 'general', 'contrarian', 'storytelling').",
    input_schema: {
      type: "object" as const,
      properties: {
        post_type: {
          type: "string",
          description: "Optional post type to filter principles by",
        },
      },
      required: [],
    },
  },
  {
    name: "search_past_posts",
    description:
      "Search the author's past LinkedIn posts by keyword. Returns post text and performance metrics. Use to find examples of their voice or successful patterns.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search keyword or phrase to match against post text",
        },
        sort_by: {
          type: "string",
          enum: ["impressions", "engagement_rate", "reactions", "comments"],
          description: "Sort results by this metric (default: impressions)",
        },
        limit: {
          type: "number",
          description: "Max results to return (1-10, default 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_platform_knowledge",
    description:
      "Retrieve LinkedIn platform knowledge on a specific aspect — algorithm behavior, best practices, and benchmarks.",
    input_schema: {
      type: "object" as const,
      properties: {
        aspect: {
          type: "string",
          enum: [
            "hooks",
            "closings",
            "length",
            "format",
            "engagement",
            "timing",
            "comments",
            "dwell_time",
            "topic_authority",
          ],
          description: "The platform knowledge aspect to retrieve",
        },
      },
      required: ["aspect"],
    },
  },
  {
    name: "update_draft",
    description:
      "Replace the current draft with a new version. Always provide the FULL draft text, not a diff. Include a brief change summary.",
    input_schema: {
      type: "object" as const,
      properties: {
        draft: {
          type: "string",
          description: "The complete new draft text",
        },
        change_summary: {
          type: "string",
          description: "Brief description of what changed and why",
        },
      },
      required: ["draft", "change_summary"],
    },
  },
];

// ── Sort column map (no string interpolation in SQL) ───────

const SORT_CLAUSES: Record<string, string> = {
  impressions: "ORDER BY m.impressions DESC NULLS LAST",
  engagement_rate: "ORDER BY m.engagement_rate DESC NULLS LAST",
  reactions: "ORDER BY m.reactions DESC NULLS LAST",
  comments: "ORDER BY m.comments DESC NULLS LAST",
};

// ── Dispatcher ─────────────────────────────────────────────

export async function executeGhostwriterTool(
  db: Database.Database,
  personaId: number,
  toolName: string,
  input: Record<string, unknown>,
  state: GhostwriterState,
  logger: AiLogger
): Promise<string> {
  try {
    const shared = await executeSharedTool(db, personaId, toolName, input, logger);
    if (shared !== null) return shared;

    switch (toolName) {
      case "get_author_profile": {
        const profile = getAuthorProfile(db, personaId);
        return profile?.profile_text ?? "No author profile found. Ask the user about their voice and expertise.";
      }

      case "lookup_principles": {
        const postType = typeof input.post_type === "string" ? input.post_type : undefined;
        const principles = getEditorialPrinciples(db, personaId, postType);
        if (principles.length === 0) {
          return "No editorial principles stored yet. These are learned from post retros over time.";
        }
        return principles
          .map(
            (p, i) =>
              `${i + 1}. ${p.principle_text}${p.source_post_type ? ` [${p.source_post_type}]` : ""} (confidence: ${p.confidence.toFixed(1)})`
          )
          .join("\n");
      }

      case "search_past_posts": {
        const query = typeof input.query === "string" ? input.query : "";
        if (!query.trim()) return "Error: query is required for search_past_posts.";

        // Escape LIKE wildcards
        const escaped = query.replace(/%/g, "\\%").replace(/_/g, "\\_");

        // Validate sort_by against allowed keys
        const sortKey =
          typeof input.sort_by === "string" && SORT_CLAUSES[input.sort_by]
            ? input.sort_by
            : "impressions";
        const orderClause = SORT_CLAUSES[sortKey]!;

        // Cap limit at 10
        let limit = typeof input.limit === "number" ? Math.floor(input.limit) : 5;
        if (limit < 1) limit = 1;
        if (limit > 10) limit = 10;

        const sql = `SELECT p.id, p.content_preview, p.full_text, p.published_at,
                        m.impressions, m.engagement_rate, m.reactions, m.comments, m.reposts, m.saves
                 FROM posts p
                 LEFT JOIN (
                   SELECT post_id, impressions, engagement_rate, reactions, comments, reposts, saves,
                          ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY scraped_at DESC) as rn
                   FROM post_metrics
                 ) m ON m.post_id = p.id AND m.rn = 1
                 WHERE p.persona_id = ?
                   AND (p.full_text LIKE ? ESCAPE '\\' OR p.content_preview LIKE ? ESCAPE '\\')
                 ${orderClause}
                 LIMIT ?`;

        const likePattern = `%${escaped}%`;
        const rows = db.prepare(sql).all(personaId, likePattern, likePattern, limit) as Array<{
          id: string;
          content_preview: string | null;
          full_text: string | null;
          published_at: string | null;
          impressions: number | null;
          engagement_rate: number | null;
          reactions: number | null;
          comments: number | null;
          reposts: number | null;
          saves: number | null;
        }>;

        if (rows.length === 0) return `No posts found matching "${query}".`;

        return rows
          .map((r, i) => {
            const text = r.full_text || r.content_preview || "(no text)";
            const truncated = text.length > 300 ? text.slice(0, 300) + "..." : text;
            const metrics = [
              r.impressions != null ? `${r.impressions} impressions` : null,
              r.engagement_rate != null ? `${r.engagement_rate.toFixed(1)}% engagement` : null,
              r.reactions != null ? `${r.reactions} reactions` : null,
              r.comments != null ? `${r.comments} comments` : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `--- Post ${i + 1} (${r.published_at ?? "unknown date"}) ---\n${truncated}\nMetrics: ${metrics || "no metrics"}`;
          })
          .join("\n\n");
      }

      case "get_platform_knowledge": {
        const aspect = typeof input.aspect === "string" ? input.aspect : "";
        return PLATFORM_KNOWLEDGE[aspect] ?? `No platform knowledge for "${aspect}".`;
      }

      case "update_draft": {
        if (
          !input.draft ||
          typeof input.draft !== "string" ||
          input.draft.trim().length < 10
        ) {
          return "Error: draft must be at least 10 characters. Provide the full draft text.";
        }
        state.currentDraft = input.draft as string;
        state.lastChangeSummary =
          typeof input.change_summary === "string" ? input.change_summary : "";
        return `Draft updated. Change: ${state.lastChangeSummary}`;
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Tool error (${toolName}): ${message}`;
  }
}
