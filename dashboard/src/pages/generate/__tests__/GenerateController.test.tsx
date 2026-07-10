/** @vitest-environment jsdom */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getActiveGeneration: vi.fn(),
  generateChatHistory: vi.fn(),
  generateDiscard: vi.fn(),
}));

vi.mock("../../../api/client", () => ({ api }));
vi.mock("../SubTabBar", () => ({ default: () => null }));
vi.mock("../DiscoveryView", () => ({
  default: (props: any) => (
    <div data-generation-id={props.gen.generationId ?? "none"} data-author-intent={props.gen.authorIntent} data-research-id={props.gen.researchId ?? "none"}>
      <button onClick={() => {
        props.onUserActed?.();
        props.setGen((previous: any) => ({
          ...previous,
          generationId: 99,
          authorIntent: "New user intent",
          researchId: 88,
          stories: [],
        }));
      }}>Submit user intent</button>
    </div>
  ),
}));
vi.mock("../DraftVariations", () => ({ default: () => null }));
vi.mock("../GhostwriterChat", () => ({ default: () => null }));
vi.mock("../Rules", () => ({ default: () => null }));
vi.mock("../Sources", () => ({ default: () => null }));
vi.mock("../GenerationHistory", () => ({ default: () => null }));
vi.mock("../PostRetro", () => ({ default: () => null }));

import Generate from "../../Generate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.generateChatHistory.mockResolvedValue([]);
  api.generateDiscard.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("Generate controller restore ownership", () => {
  it("does not let delayed active restore overwrite a user-started researched generation", async () => {
    const active = deferred<{ generation: any }>();
    api.getActiveGeneration.mockReturnValueOnce(active.promise);
    await act(async () => root.render(<Generate />));

    await act(async () => {
      [...container.querySelectorAll("button")].find((item) => item.textContent === "Submit user intent")!.click();
    });
    expect(container.querySelector("[data-generation-id]")?.getAttribute("data-generation-id")).toBe("99");

    await act(async () => active.resolve({
      generation: {
        id: 73,
        author_intent: "Delayed restored intent",
        research_id: 72,
        post_type: "general",
        selected_story_index: null,
        drafts_json: null,
        selected_draft_indices: null,
        final_draft: null,
        quality_gate_json: null,
        combining_guidance: null,
        personal_connection: null,
        draft_length: null,
        prompt_snapshot: null,
        status: "drafting",
        persona_id: 1,
        brainstorm_topic: null,
        brainstorm_angle: null,
        created_at: "2026-07-10T00:00:00Z",
        stories: [],
        article_count: 0,
        source_count: 0,
      },
    }));

    const view = container.querySelector("[data-generation-id]");
    expect(view?.getAttribute("data-generation-id")).toBe("99");
    expect(view?.getAttribute("data-author-intent")).toBe("New user intent");
    expect(view?.getAttribute("data-research-id")).toBe("88");
  });
});
