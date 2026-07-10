import { z } from "zod";
import type { Story } from "../db/generate-queries.js";

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

const providerDateSchema = z.string()
  .refine(validIsoDate)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const httpUrlSchema = z.string().url().refine((url) => {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
});

const intentSearchResultSchema = z.object({
  title: z.string().min(1),
  url: httpUrlSchema,
  snippet: z.string(),
  date: providerDateSchema,
  last_updated: providerDateSchema,
});

const perplexitySearchResponseSchema = z.object({
  results: z.array(intentSearchResultSchema),
});

const storySchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  source: z.string().min(1),
  source_url: httpUrlSchema,
  age: z.string().min(1),
  tag: z.string().min(1),
  angles: z.array(z.string().min(1)),
  is_stretch: z.boolean(),
}).strict();

export type IntentSearchResult = z.infer<typeof intentSearchResultSchema>;

export interface IntentSearchRequest {
  query: string;
  after?: string;
}

export interface IntentResearchResult {
  stories: Story[];
  evidence: IntentSearchResult[];
  searchScope: "recent" | "all_time";
  recentCutoff: string;
}

type Search = (request: IntentSearchRequest) => Promise<IntentSearchResult[]>;
type SelectRelevant = (request: {
  intent: string;
  pages: IntentSearchResult[];
}) => Promise<unknown>;
type Synthesize = (request: {
  intent: string;
  pages: IntentSearchResult[];
}) => Promise<unknown>;

function formatPerplexityDate(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${date.getUTCFullYear()}`;
}

function subtractCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - months;
  const day = date.getUTCDate();
  const targetStart = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(
    targetStart.getUTCFullYear(),
    targetStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  return new Date(Date.UTC(
    targetStart.getUTCFullYear(),
    targetStart.getUTCMonth(),
    Math.min(day, lastDay),
  ));
}

function validHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function recentCandidate(result: IntentSearchResult, cutoff: Date): boolean {
  if (!validHttpUrl(result.url) || !result.date?.trim()) return false;
  const publishedAt = Date.parse(result.date);
  return Number.isFinite(publishedAt) && publishedAt > cutoff.getTime();
}

function validAllTimeCandidate(result: IntentSearchResult): boolean {
  return validHttpUrl(result.url);
}

function validateProviderDates(results: IntentSearchResult[]): IntentSearchResult[] {
  return results.map((result) => {
    const date = providerDateSchema.safeParse(result.date);
    const lastUpdated = providerDateSchema.safeParse(result.last_updated);
    if (!date.success || !lastUpdated.success) {
      throw new Error("Invalid Perplexity Search results");
    }
    if (result.date === date.data && result.last_updated === lastUpdated.data) {
      return result;
    }
    return { ...result, date: date.data, last_updated: lastUpdated.data };
  });
}

async function selectPages(
  intent: string,
  pages: IntentSearchResult[],
  selectRelevant: SelectRelevant,
): Promise<IntentSearchResult[]> {
  if (pages.length === 0) return [];

  const pagesById = new Map(pages.map((page) => [page.url, page]));
  if (pagesById.size !== pages.length) {
    throw new Error("Search results contain duplicate IDs");
  }

  const selectedIds = z.array(z.string()).parse(
    await selectRelevant({
      intent,
      pages: pages.map((page) => ({ ...page })),
    }),
  );
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("Relevance selection returned duplicate IDs");
  }

  const selected: IntentSearchResult[] = [];
  for (const id of selectedIds) {
    const page = pagesById.get(id);
    if (!page) {
      throw new Error("Relevance selection returned an unknown ID");
    }
    selected.push(page);
  }
  return selected;
}

async function synthesizeStories(
  intent: string,
  pages: IntentSearchResult[],
  synthesize: Synthesize,
): Promise<Story[]> {
  const parsed = storySchema.array().min(1).max(3).safeParse(
    await synthesize({ intent, pages }),
  );
  const selectedUrls = new Set(pages.map((page) => page.url));
  if (!parsed.success || parsed.data.some((story) => !selectedUrls.has(story.source_url))) {
    throw new Error("Synthesis returned invalid stories");
  }
  return parsed.data;
}

export async function searchPerplexity(
  request: IntentSearchRequest,
): Promise<IntentSearchResult[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error("PERPLEXITY_API_KEY is required for intent research");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://api.perplexity.ai/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: request.query,
        ...(request.after ? { search_after_date_filter: request.after } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Perplexity Search API error: ${response.status}${detail ? ` ${detail}` : ""}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
        throw error;
      }
      throw new Error("Invalid Perplexity Search response");
    }
    const parsed = perplexitySearchResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("Invalid Perplexity Search response");
    }
    return parsed.data.results;
  } finally {
    clearTimeout(timeout);
  }
}

export async function researchIntent({
  intent,
  now,
  search,
  selectRelevant,
  synthesize,
}: {
  intent: string;
  now: Date;
  search: Search;
  selectRelevant: SelectRelevant;
  synthesize: Synthesize;
}): Promise<IntentResearchResult> {
  const cutoff = subtractCalendarMonths(now, 2);
  const recentCutoff = formatPerplexityDate(cutoff);
  const recentResults = validateProviderDates(
    await search({ query: intent, after: recentCutoff }),
  );
  const recentCandidates = recentResults.filter((result) => recentCandidate(result, cutoff));
  const recentRelevant = await selectPages(intent, recentCandidates, selectRelevant);

  if (recentRelevant.length > 0) {
    return {
      stories: await synthesizeStories(intent, recentRelevant, synthesize),
      evidence: recentRelevant,
      searchScope: "recent",
      recentCutoff,
    };
  }

  const allTimeResults = validateProviderDates(await search({ query: intent }));
  const allTimeCandidates = allTimeResults.filter(validAllTimeCandidate);
  const allTimeRelevant = await selectPages(intent, allTimeCandidates, selectRelevant);
  if (allTimeRelevant.length === 0) {
    return {
      stories: [],
      evidence: [],
      searchScope: "all_time",
      recentCutoff,
    };
  }

  return {
    stories: await synthesizeStories(intent, allTimeRelevant, synthesize),
    evidence: allTimeRelevant,
    searchScope: "all_time",
    recentCutoff,
  };
}
