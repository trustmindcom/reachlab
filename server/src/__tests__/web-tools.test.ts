import { describe, it, expect } from "vitest";
import { buildChatSearchPrompt, extractArticle, isPrivateUrl } from "../ai/web-tools.js";

describe("buildChatSearchPrompt", () => {
  it("returns the query directly without research framing", () => {
    const prompt = buildChatSearchPrompt("OpenAI funding round 2026");
    expect(prompt).toContain("OpenAI funding round 2026");
    expect(prompt).not.toContain("practitioner discussions");
  });
});

describe("isPrivateUrl", () => {
  it("blocks localhost", () => expect(isPrivateUrl("http://localhost:3000/api")).toBe(true));
  it("blocks 127.x", () => expect(isPrivateUrl("http://127.0.0.1/secret")).toBe(true));
  it("blocks 10.x", () => expect(isPrivateUrl("http://10.0.0.1/admin")).toBe(true));
  it("blocks 192.168.x", () => expect(isPrivateUrl("http://192.168.1.1/config")).toBe(true));
  it("blocks 172.16-31.x", () => expect(isPrivateUrl("http://172.20.0.1/admin")).toBe(true));
  it("blocks IPv6 loopback", () => expect(isPrivateUrl("http://[::1]:3000/api")).toBe(true));
  it("allows public URLs", () => expect(isPrivateUrl("https://example.com/article")).toBe(false));
});

describe("extractArticle", () => {
  it("extracts text from simple HTML", () => {
    const html = `<html><head><title>Test</title></head><body>
      <article><p>Hello world. This is article content that is long enough to extract.</p></article>
      <nav>Navigation stuff</nav>
    </body></html>`;
    const result = extractArticle(html, "https://example.com");
    expect(result.text).toContain("Hello world");
    expect(result.title).toBe("Test");
  });

  it("falls back to tag stripping for non-article pages", () => {
    const html = "<div><span>Just some text</span></div>";
    const result = extractArticle(html, "https://example.com");
    expect(result.text).toContain("Just some text");
  });

  it("truncates to 8000 chars", () => {
    const html = `<html><head><title>Long</title></head><body><article><p>${"a".repeat(10000)}</p></article></body></html>`;
    const result = extractArticle(html, "https://example.com");
    expect(result.text.length).toBeLessThanOrEqual(8000);
  });
});
