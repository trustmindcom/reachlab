import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import type Database from "better-sqlite3";
import type { AiLogger } from "./logger.js";
import { SHARED_TOOLS, executeSharedTool, WEIGHTED_ER_SQL } from "./shared-tools.js";
import {
  getCategoryPerformance,
  getEngagementQuality,
  getTopicPerformance,
  getProgressMetrics,
  getHookPerformance,
} from "../db/ai/deep-dive.js";
import { queryTiming } from "../db/queries.js";
import { computeWeightedER } from "./stats-report.js";

// ── Sort clauses for query_posts ─────────────────────────

const SORT_CLAUSES: Record<string, string> = {
  impressions: "ORDER BY m.impressions DESC NULLS LAST",
  engagement_rate: `ORDER BY ${WEIGHTED_ER_SQL} DESC`,
  reactions: "ORDER BY m.reactions DESC NULLS LAST",
  comments: "ORDER BY m.comments DESC NULLS LAST",
  published_at: "ORDER BY p.published_at DESC",
};

// ── Coach-specific tool definitions ──────────────────────

const COACH_SPECIFIC_TOOLS: Tool[] = [
  {
    name: "query_posts",
    description:
      "Search and filter the user's LinkedIn posts by keyword, time range, and sort order. Returns post text and performance metrics.",
    input_schema: {
      type: "object" as const,
      properties: {
        keyword: {
          type: "string",
          description: "Search keyword to match against post text (optional)",
        },
        days_back: {
          type: "number",
          description: "Only include posts from the last N days (optional)",
        },
        sort_by: {
          type: "string",
          enum: ["impressions", "engagement_rate", "reactions", "comments", "published_at"],
          description: "Sort results by this field (default: published_at)",
        },
        limit: {
          type: "number",
          description: "Max results to return (1-20, default 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_performance_summary",
    description:
      "Get a summary of the user's posting performance for a time period — median ER, median impressions, total posts, and avg comments. Compares current period vs previous period of the same length.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: {
          type: "number",
          description: "Number of days for the current period (default: 30). Previous period is the same length immediately before.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_category_breakdown",
    description:
      "Get performance broken down by content category (e.g. storytelling, contrarian, educational). Shows median ER, impressions, and a status label for each category.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_topic_performance",
    description:
      "Get performance broken down by topic. Shows median weighted ER, impressions, and comments per topic.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: {
          type: "number",
          description: "Only include posts from the last N days (optional, all time if omitted)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_timing_analysis",
    description:
      "Get posting time analysis — average engagement rate and post count by day of week and hour. Use to advise on optimal posting times.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_engagement_quality",
    description:
      "Get engagement quality metrics — comment ratio, save rate, repost rate, weighted ER vs standard ER. Indicates depth of audience engagement beyond surface-level reactions.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_hook_analysis",
    description:
      "Get performance broken down by hook type and format style. Shows which opening strategies and post formats drive the best results.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: {
          type: "number",
          description: "Only include posts from the last N days (optional, all time if omitted)",
        },
      },
      required: [],
    },
  },
];

export const COACH_CHAT_TOOLS: Tool[] = [...COACH_SPECIFIC_TOOLS, ...SHARED_TOOLS];

// ── Dispatcher ───────────────────────────────────────────

export async function executeCoachTool(
  db: Database.Database,
  personaId: number,
  toolName: string,
  input: Record<string, unknown>,
  logger: AiLogger
): Promise<string> {
  // Try shared tools first
  const shared = await executeSharedTool(db, personaId, toolName, input, logger);
  if (shared !== null) return shared;

  switch (toolName) {
    case "query_posts": {
      const conditions: string[] = ["p.persona_id = ?"];
      const params: any[] = [personaId];

      // Keyword search
      if (typeof input.keyword === "string" && input.keyword.trim()) {
        const escaped = input.keyword.replace(/%/g, "\\%").replace(/_/g, "\\_");
        const likePattern = `%${escaped}%`;
        conditions.push("(p.full_text LIKE ? ESCAPE '\\' OR p.content_preview LIKE ? ESCAPE '\\')");
        params.push(likePattern, likePattern);
      }

      // Days back filter
      if (typeof input.days_back === "number" && input.days_back > 0) {
        conditions.push("p.published_at > datetime('now', '-' || ? || ' days')");
        params.push(Math.floor(input.days_back));
      }

      // Sort
      const sortKey =
        typeof input.sort_by === "string" && SORT_CLAUSES[input.sort_by]
          ? input.sort_by
          : "published_at";
      const orderClause = SORT_CLAUSES[sortKey]!;

      // Limit
      let limit = typeof input.limit === "number" ? Math.floor(input.limit) : 10;
      if (limit < 1) limit = 1;
      if (limit > 20) limit = 20;

      const sql = `SELECT p.id, p.content_preview, p.full_text, p.published_at, p.content_type,
                      m.impressions, m.reactions, m.comments, m.reposts, m.saves, m.sends,
                      t.post_category
               FROM posts p
               LEFT JOIN (
                 SELECT post_id, impressions, reactions, comments, reposts, saves, sends,
                        ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY scraped_at DESC) as rn
                 FROM post_metrics
               ) m ON m.post_id = p.id AND m.rn = 1
               LEFT JOIN ai_tags t ON t.post_id = p.id
               WHERE ${conditions.join(" AND ")}
               ${orderClause}
               LIMIT ?`;

      params.push(limit);
      const rows = db.prepare(sql).all(...params) as any[];

      if (rows.length === 0) return "No posts found matching your criteria.";

      return rows
        .map((r, i) => {
          const text = (r.full_text || r.content_preview || "").slice(0, 200);
          const wer = r.impressions > 0
            ? computeWeightedER(r.reactions ?? 0, r.comments ?? 0, r.reposts ?? 0, r.saves, r.sends, r.impressions)
            : null;
          const lines = [
            `${i + 1}. [${r.published_at ?? "unknown date"}] ${r.content_type ?? "text"}${r.post_category ? ` | ${r.post_category}` : ""}`,
            `   "${text}${text.length >= 200 ? "..." : ""}"`,
            `   Impressions: ${r.impressions ?? "N/A"} | Reactions: ${r.reactions ?? 0} | Comments: ${r.comments ?? 0} | Reposts: ${r.reposts ?? 0} | Saves: ${r.saves ?? 0}`,
          ];
          if (wer != null) {
            lines.push(`   Weighted ER: ${wer.toFixed(2)}%`);
          }
          return lines.join("\n");
        })
        .join("\n\n");
    }

    case "get_performance_summary": {
      const days = typeof input.days === "number" && input.days > 0 ? input.days : 30;
      const { current, previous } = getProgressMetrics(db, personaId, days);

      const fmt = (s: typeof current, label: string) => {
        if (s.total_posts === 0) return `${label}: No posts in this period.`;
        return [
          `${label} (${s.total_posts} posts):`,
          `  Median ER: ${s.median_er != null ? s.median_er + "%" : "N/A"}`,
          `  Median Impressions: ${s.median_impressions ?? "N/A"}`,
          `  Avg Comments: ${s.avg_comments ?? "N/A"}`,
        ].join("\n");
      };

      return [
        fmt(current, `Current ${days} days`),
        fmt(previous, `Previous ${days} days`),
      ].join("\n\n");
    }

    case "get_category_breakdown": {
      const categories = getCategoryPerformance(db, personaId);
      if (categories.length === 0) return "No category data available yet.";

      return categories
        .map(
          (c) =>
            `${c.category} (${c.post_count} posts) — Median ER: ${c.median_er ?? "N/A"}%, Impressions: ${c.median_impressions ?? "N/A"}, Status: ${c.status}`
        )
        .join("\n");
    }

    case "get_topic_performance": {
      const days = typeof input.days === "number" && input.days > 0 ? input.days : undefined;
      const topics = getTopicPerformance(db, personaId, days);
      if (topics.length === 0) return "No topic data available yet.";

      return topics
        .map(
          (t) =>
            `${t.topic} (${t.post_count} posts) — Median WER: ${t.median_wer}%, Impressions: ${t.median_impressions}, Comments: ${t.median_comments}`
        )
        .join("\n");
    }

    case "get_timing_analysis": {
      const slots = queryTiming(db, personaId) as Array<{
        day: number;
        hour: number;
        avg_engagement_rate: number | null;
        post_count: number;
      }>;
      if (slots.length === 0) return "No timing data available yet.";

      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return slots
        .map(
          (s) =>
            `${dayNames[s.day]} ${String(s.hour).padStart(2, "0")}:00 — ${s.post_count} posts, Avg ER: ${s.avg_engagement_rate != null ? (s.avg_engagement_rate * 100).toFixed(2) + "%" : "N/A"}`
        )
        .join("\n");
    }

    case "get_engagement_quality": {
      const eq = getEngagementQuality(db, personaId);
      if (eq.total_posts === 0) return "No engagement data available yet.";

      return [
        `Engagement Quality (${eq.total_posts} posts):`,
        `  Comment Ratio (comments/reactions): ${eq.comment_ratio ?? "N/A"}`,
        `  Save Rate: ${eq.save_rate != null ? eq.save_rate + "%" : "N/A"}`,
        `  Repost Rate: ${eq.repost_rate != null ? eq.repost_rate + "%" : "N/A"}`,
        `  Weighted ER: ${eq.weighted_er != null ? eq.weighted_er + "%" : "N/A"}`,
        `  Standard ER: ${eq.standard_er != null ? eq.standard_er + "%" : "N/A"}`,
      ].join("\n");
    }

    case "get_hook_analysis": {
      const days = typeof input.days === "number" && input.days > 0 ? input.days : undefined;
      const { by_hook_type, by_format_style } = getHookPerformance(db, personaId, days);

      const fmtList = (items: Array<{ name: string; post_count: number; median_wer: number; median_impressions: number; median_comments: number }>) =>
        items
          .map(
            (h) =>
              `  ${h.name} (${h.post_count} posts) — Median WER: ${h.median_wer}%, Impressions: ${h.median_impressions}, Comments: ${h.median_comments}`
          )
          .join("\n");

      const parts: string[] = [];
      if (by_hook_type.length > 0) {
        parts.push(`Hook Types:\n${fmtList(by_hook_type)}`);
      }
      if (by_format_style.length > 0) {
        parts.push(`Format Styles:\n${fmtList(by_format_style)}`);
      }
      return parts.length > 0 ? parts.join("\n\n") : "No hook/format data available yet.";
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}
