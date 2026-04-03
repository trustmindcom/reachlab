import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import type Database from "better-sqlite3";
import type { AiLogger } from "./logger.js";
import { chatWebSearch, fetchUrl } from "./web-tools.js";
import { getRules, updateRule, insertSingleRule, getMaxRuleSortOrder, softDeleteRule } from "../db/generate-queries.js";

/** Weighted ER SQL expression for ORDER BY clauses — must match computeWeightedER in stats-report.ts */
export const WEIGHTED_ER_SQL = "(CASE WHEN m.impressions > 0 THEN CAST((m.comments * 5 + m.reposts * 3 + COALESCE(m.saves, 0) * 3 + COALESCE(m.sends, 0) * 3 + m.reactions) AS REAL) / m.impressions ELSE 0 END)";

export const SHARED_TOOLS: Tool[] = [
  {
    name: "get_rules",
    description:
      "Retrieve the user's manually configured writing rules — voice/tone, structure, and anti-AI-tropes guardrails.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "web_search",
    description:
      "Search the web for current information, examples, or research to inform the draft. Returns content with citations.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch and extract article text from a URL. Use to read a specific page for research or reference.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "add_or_update_rule",
    description:
      "Add a new writing rule or update an existing one. Use to persist a style preference or guardrail the user expresses.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: ["voice_tone", "structure", "anti_ai_tropes"],
          description: "Category of the rule",
        },
        rule_text: {
          type: "string",
          description: "The rule text",
        },
        rule_id: {
          type: "number",
          description: "Rule ID to update (omit to add a new rule)",
        },
        example_text: {
          type: "string",
          description: "Optional example illustrating the rule",
        },
      },
      required: ["category", "rule_text"],
    },
  },
  {
    name: "delete_rule",
    description:
      "Soft-delete a writing rule by ID. The rule can be restored later. Use when the user wants to remove a rule that's no longer relevant. Always confirm with the user before deleting.",
    input_schema: {
      type: "object" as const,
      properties: {
        rule_id: {
          type: "number",
          description: "ID of the rule to delete (get IDs from get_rules)",
        },
      },
      required: ["rule_id"],
    },
  },
];

// Returns null if toolName is not a shared tool
export async function executeSharedTool(
  db: Database.Database,
  personaId: number,
  toolName: string,
  input: Record<string, unknown>,
  logger: AiLogger
): Promise<string | null> {
  switch (toolName) {
    case "get_rules": {
      const rules = getRules(db, personaId).filter((r) => r.enabled);
      if (rules.length === 0) return "No writing rules configured.";
      return rules
        .map((r) => `- [id:${r.id}] [${r.category}] [${r.origin}] ${r.rule_text}${r.example_text ? ` (e.g. ${r.example_text})` : ""}`)
        .join("\n");
    }

    case "web_search": {
      const query = typeof input.query === "string" ? input.query : "";
      if (!query.trim()) return "Error: query is required.";
      try {
        return await chatWebSearch(query, logger);
      } catch (err: unknown) {
        return `Web search failed: ${err instanceof Error ? err.message : String(err)}. Proceeding without search results.`;
      }
    }

    case "fetch_url": {
      const url = typeof input.url === "string" ? input.url : "";
      if (!url.trim()) return "Error: url is required.";
      return fetchUrl(url);
    }

    case "delete_rule": {
      const ruleId = typeof input.rule_id === "number" ? input.rule_id : null;
      if (ruleId === null) return "Error: rule_id is required.";
      const deleted = softDeleteRule(db, ruleId, personaId);
      if (!deleted) return `Error: Rule id:${ruleId} not found or already deleted. Use get_rules to find valid rule IDs.`;
      return `Rule deleted (id:${ruleId}). It can be restored from the Rules settings page.`;
    }

    case "add_or_update_rule": {
      const ruleText = typeof input.rule_text === "string" ? input.rule_text : "";
      if (!ruleText.trim()) return "Error: rule_text is required.";
      const category = typeof input.category === "string" ? input.category : "voice_tone";
      const exampleText = typeof input.example_text === "string" ? input.example_text : undefined;

      if (typeof input.rule_id === "number") {
        const updated = updateRule(db, input.rule_id, personaId, { rule_text: ruleText, example_text: exampleText });
        if (!updated) return `Error: Rule id:${input.rule_id} not found or not owned by this persona. Use get_rules to find valid rule IDs.`;
        return `Rule updated (id:${input.rule_id}): ${ruleText}`;
      }

      const sortOrder = getMaxRuleSortOrder(db, category, personaId) + 1;
      insertSingleRule(db, personaId, category, ruleText, sortOrder, "auto");
      return `Rule added [${category}]: ${ruleText}`;
    }

    default:
      return null;
  }
}
