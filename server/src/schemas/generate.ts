import { z } from "zod";

export const researchBody = z.object({
  topic: z.string().trim().min(1),
  avoid: z.array(z.string().max(500)).max(50).optional(),
  sources: z.array(z.string()).optional(),
});

export const draftsBody = z.object({
  research_id: z.number().int().positive(),
  story_index: z.number().int().min(0),
  personal_connection: z.string().optional(),
  length: z.enum(["short", "medium", "long"]).optional(),
});

export const reviseDraftsBody = z.object({
  generation_id: z.number().int().positive(),
  feedback: z.string().trim().min(1).max(2000),
});

export const combineBody = z.object({
  generation_id: z.number().int().positive(),
  selected_drafts: z.array(z.number().int().min(0)),
  combining_guidance: z.string().optional(),
});

export const chatBody = z.object({
  generation_id: z.number().int().positive(),
  message: z.string().trim().min(1).max(5000),
  edited_draft: z.string().optional(),
});

const ruleItem = z.object({
  rule_text: z.string().min(1),
  example_text: z.string().optional(),
  sort_order: z.number(),
  enabled: z.number().optional(),
});

export const rulesBody = z.object({
  categories: z.object({
    voice_tone: z.array(ruleItem),
    structure_formatting: z.array(ruleItem),
    anti_ai_tropes: z.object({
      enabled: z.boolean(),
      rules: z.array(ruleItem),
    }),
  }),
});

export const addRuleBody = z.object({
  category: z.string().min(1),
  rule_text: z.string().min(1),
});

export const retroBody = z.object({
  published_text: z.string().min(1),
});

export const coachingChangeBody = z.object({
  action: z.string().min(1),
  edited_text: z.string().optional(),
});

export const sourceUrlBody = z.object({
  url: z.string().url().min(1),
});

export const sourceUpdateBody = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
});

export const sourceDiscoverBody = z.object({
  topics: z.array(z.string()).optional(),
});

export const ghostwriteBody = z.object({
  generation_id: z.number().int().positive(),
  message: z.string().trim().min(1).max(10000),
  current_draft: z.string().max(50000).optional(),
});

export const selectionBody = z.object({
  selected_draft_indices: z.array(z.number().int().min(0)).max(10),
  combining_guidance: z.string().max(5000).optional(),
});

export const draftSaveBody = z.object({
  draft: z.string().min(1).max(50000),
});
