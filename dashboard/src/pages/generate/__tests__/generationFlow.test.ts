import { describe, expect, it } from "vitest";
import {
  canGenerateDrafts,
  canRetryResearch,
  resolveAmbientIntent,
  shouldClearAmbientSelection,
  type ResearchRequest,
} from "../generationFlow";

describe("generation flow policy", () => {
  it("clears ambient selection only for non-blank submitted intent", () => {
    expect(shouldClearAmbientSelection("  write about durable systems  ")).toBe(true);
    expect(shouldClearAmbientSelection("  \n\t ")).toBe(false);
  });

  it("allows intent-only drafts with no selected story and zero evidence", () => {
    expect(canGenerateDrafts({
      generationId: 41,
      researchStatus: "succeeded",
      allowIntentOnlyAfterFailure: false,
    })).toBe(true);
  });

  it("blocks drafts without a generation or while research is loading", () => {
    expect(canGenerateDrafts({
      generationId: null,
      researchStatus: "idle",
      allowIntentOnlyAfterFailure: false,
    })).toBe(false);
    expect(canGenerateDrafts({
      generationId: 41,
      researchStatus: "loading",
      allowIntentOnlyAfterFailure: true,
    })).toBe(false);
  });

  it("requires the explicit failure override after research fails", () => {
    expect(canGenerateDrafts({
      generationId: 41,
      researchStatus: "failed",
      allowIntentOnlyAfterFailure: false,
    })).toBe(false);
    expect(canGenerateDrafts({
      generationId: 41,
      researchStatus: "failed",
      allowIntentOnlyAfterFailure: true,
    })).toBe(true);
  });

  it("uses editable guidance as ambient intent and the visible label as blank fallback", () => {
    expect(resolveAmbientIntent("  My operational take  ", "Visible headline")).toBe("My operational take");
    expect(resolveAmbientIntent("  ", "  Visible headline  ")).toBe("Visible headline");
  });

  it("only offers anchored retry for an identical same-session request", () => {
    const request: ResearchRequest = {
      generationId: 41,
      authorIntent: "My operational take",
      sourceContext: {
        summary: "Evidence summary",
        source_headline: "Visible headline",
        source_url: "https://example.com/evidence",
      },
    };

    expect(canRetryResearch("failed", request, request)).toBe(true);
    expect(canRetryResearch("failed", null, request)).toBe(false);
    expect(canRetryResearch("idle", request, request)).toBe(false);
    expect(canRetryResearch("failed", request, { ...request, authorIntent: "Changed" })).toBe(false);
  });
});
