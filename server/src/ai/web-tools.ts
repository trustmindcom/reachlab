import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { searchWithSonarPro } from "./perplexity.js";
import type { AiLogger } from "./logger.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 8_000;

export function buildChatSearchPrompt(query: string): string {
  return `Find current, factual information about: ${query}\n\nInclude specific details, dates, names, and sources. Focus on recent developments.`;
}

export function isPrivateUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === "localhost" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.startsWith("0.")
    );
  } catch {
    return true;
  }
}

export interface ArticleResult {
  title: string;
  text: string;
}

export function extractArticle(html: string, url: string): ArticleResult {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article && (article.textContent ?? "").trim().length > 50) {
    const text = (article.textContent ?? "").trim().slice(0, MAX_TEXT_CHARS);
    return { title: article.title || "", text };
  }

  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
  return { title: "", text };
}

export async function chatWebSearch(query: string, logger: AiLogger): Promise<string> {
  const result = await searchWithSonarPro(query, logger, buildChatSearchPrompt(query));
  const citations = result.citations.length > 0
    ? `\n\nSources:\n${result.citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")}`
    : "";
  return `${result.content}${citations}`;
}

export async function fetchUrl(url: string): Promise<string> {
  if (isPrivateUrl(url)) {
    return "Error: Cannot fetch private/internal URLs.";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ReachLab/1.0 (content research)" },
    });

    if (!response.ok) {
      return `Error: HTTP ${response.status} fetching ${url}`;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return `Error: Unsupported content type: ${contentType}`;
    }

    const reader = response.body?.getReader();
    if (!reader) return "Error: No response body";

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) break;
      chunks.push(value);
    }

    const byteLength = Math.min(totalBytes, MAX_BODY_BYTES);
    const allBytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      const toWrite = chunk.slice(0, byteLength - offset);
      allBytes.set(toWrite, offset);
      offset += toWrite.byteLength;
      if (offset >= byteLength) break;
    }
    const text = new TextDecoder().decode(allBytes);

    if (contentType.includes("text/plain")) {
      return text.slice(0, MAX_TEXT_CHARS);
    }

    const article = extractArticle(text, url);
    return article.title
      ? `**${article.title}**\n\n${article.text}`
      : article.text;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return `Error: Timeout fetching ${url} (${FETCH_TIMEOUT_MS / 1000}s limit)`;
    }
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timeout);
  }
}
