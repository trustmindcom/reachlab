import type { Tool } from "@anthropic-ai/sdk/resources/index.js";
import type Database from "better-sqlite3";
import type { AiLogger } from "./logger.js";
import { chatWebSearch, fetchUrl } from "./web-tools.js";
import { getRules, updateRule, insertSingleRule, getMaxRuleSortOrder } from "../db/generate-queries.js";

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

    case "add_or_update_rule": {
      const ruleText = typeof input.rule_text === "string" ? input.rule_text : "";
      if (!ruleText.trim()) return "Error: rule_text is required.";
      const category = typeof input.category === "string" ? input.category : "voice_tone";
      const exampleText = typeof input.example_text === "string" ? input.example_text : undefined;

      if (typeof input.rule_id === "number") {
        updateRule(db, input.rule_id, personaId, { rule_text: ruleText, example_text: exampleText });
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
