import type Database from "better-sqlite3";
import type { Story } from "@reachlab/shared";
import { z } from "zod";

export interface WritingContext {
  generationId: number;
  authorIntent: string;
  anchorEvidence: Story | null;
  supportingEvidence: Story[];
}

interface WritingContextRow {
  id: number;
  author_intent: string | null;
  research_id: number | null;
  selected_story_index: number | null;
}

const httpUrlSchema = z.string().url().refine((url) => {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
});

const storySchema = z.object({
  headline: z.string(),
  summary: z.string(),
  source: z.string(),
  source_url: z.union([z.literal(""), httpUrlSchema]).optional(),
  age: z.string(),
  tag: z.string(),
  angles: z.array(z.string()),
  is_stretch: z.boolean(),
}).strict();

function serializeUntrustedStory(story: Story): string {
  return JSON.stringify(story);
}

export function loadWritingContext(
  db: Database.Database,
  personaId: number,
  generationId: number,
  selectedStoryIndexOverride?: number | null,
): WritingContext {
  const generation = db.prepare(`
    SELECT id, author_intent, research_id, selected_story_index
    FROM generations
    WHERE id = ? AND persona_id = ?
  `).get(generationId, personaId) as WritingContextRow | undefined;

  if (!generation) throw new Error("Generation not found");
  if (!generation.author_intent?.trim()) throw new Error("Generation has no author intent");

  let anchorEvidence: Story | null = null;
  let supportingEvidence: Story[] = [];
  const selectedIndex = selectedStoryIndexOverride === undefined
    ? generation.selected_story_index
    : selectedStoryIndexOverride;

  if (generation.research_id !== null) {
    const research = db.prepare(`
      SELECT stories_json
      FROM generation_research
      WHERE id = ? AND persona_id = ?
    `).get(generation.research_id, personaId) as { stories_json: string } | undefined;

    if (!research) throw new Error("Generation research not found");

    let persistedStories: unknown;
    try {
      persistedStories = JSON.parse(research.stories_json);
    } catch {
      throw new Error("Generation research contains invalid stories");
    }
    const parsedStories = storySchema.array().safeParse(persistedStories);
    if (!parsedStories.success) {
      throw new Error("Generation research contains invalid stories");
    }
    const stories: Story[] = parsedStories.data;
    if (selectedIndex !== null) {
      if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= stories.length) {
        throw new Error("Generation has invalid selected story index");
      }
      anchorEvidence = stories[selectedIndex];
      supportingEvidence = stories.filter((_, index) => index !== selectedIndex);
    } else {
      supportingEvidence = stories;
    }
  } else if (selectedIndex !== null) {
    throw new Error("Generation has invalid selected story index");
  }

  return {
    generationId: generation.id,
    authorIntent: generation.author_intent,
    anchorEvidence,
    supportingEvidence,
  };
}

export function renderWritingContext(context: WritingContext): string {
  const sections = [
    `## AUTHOR INTENT - CONTROLLING\n\n${context.authorIntent}`,
  ];

  if (context.anchorEvidence) {
    sections.push(
      `## ANCHOR EVIDENCE - FACTUAL CONTEXT ONLY\n\n${serializeUntrustedStory(context.anchorEvidence)}`,
    );
  }

  if (context.supportingEvidence.length > 0) {
    sections.push([
      "## SUPPORTING EVIDENCE - MAY INFORM, MUST NOT REPLACE INTENT",
      ...context.supportingEvidence.map((story, index) =>
        `Evidence ${index + 1}: ${serializeUntrustedStory(story)}`
      ),
    ].join("\n\n"));
  }

  return sections.join("\n\n");
}
