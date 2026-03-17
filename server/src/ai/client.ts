import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  HAIKU: "anthropic/claude-haiku-4-5-20251001",
  SONNET: "anthropic/claude-sonnet-4-6",
  OPUS: "anthropic/claude-opus-4-6",
} as const;

export function createClient(apiKey: string): Anthropic {
  if (!apiKey)
    throw new Error("TRUSTMIND_LLM_API_KEY is required for AI features");
  return new Anthropic({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
}
