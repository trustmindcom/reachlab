/** @vitest-environment jsdom */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationState } from "../../Generate";

const api = vi.hoisted(() => ({
  reviseDrafts: vi.fn(),
  saveSelection: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  api,
}));
vi.mock("../../Generate", () => ({}));
vi.mock("../components/ScannerLoader", () => ({ default: () => <div>Loading drafts</div> }));

import DraftVariations from "../DraftVariations";

const drafts = [0, 1, 2].map((index) => ({
  type: (["contrarian", "operator", "future"] as const)[index],
  hook: `Hook ${index}`,
  body: `Body ${index}`,
  closing: `Closing ${index}`,
  word_count: 100 + index,
  structure_label: `Structure ${index}`,
}));

function state(selectedDraftIndices: number[] = []): GenerationState {
  return {
    authorIntent: "Write about durable systems",
    discoveryTopics: null,
    researchId: 9,
    stories: [],
    articleCount: 0,
    sourceCount: 0,
    selectedStoryIndex: null,
    generationId: 55,
    drafts,
    selectedDraftIndices,
    combiningGuidance: "",
    personalConnection: "",
    draftLength: "medium",
    originalDraft: "",
    finalDraft: "",
    qualityGate: null,
    appliedInsights: [],
    chatMessages: [],
  };
}

function Harness({ initial, onState }: { initial: GenerationState; onState: (value: GenerationState) => void }) {
  const [gen, setGen] = React.useState(initial);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => onState(gen), [gen, onState]);
  return (
    <DraftVariations
      gen={gen}
      setGen={setGen}
      loading={loading}
      setLoading={setLoading}
      onBack={() => {}}
      onNext={() => {}}
    />
  );
}

function LifecycleHarness({ onState }: { onState: (value: GenerationState) => void }) {
  const [gen, setGen] = React.useState(state());
  const [loading, setLoading] = React.useState(false);
  const [showReview, setShowReview] = React.useState(true);
  React.useEffect(() => onState(gen), [gen, onState]);
  return (
    <>
      <button onClick={() => {
        setShowReview(false);
        setGen({ ...state(), generationId: 77, authorIntent: "A newer intent" });
      }}>Reset review</button>
      <button onClick={() => setShowReview(true)}>Remount review</button>
      <output data-shared-loading>{String(loading)}</output>
      {showReview && (
        <DraftVariations
          gen={gen}
          setGen={setGen}
          loading={loading}
          setLoading={setLoading}
          onBack={() => setShowReview(false)}
          onNext={() => setShowReview(false)}
        />
      )}
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
let latest: GenerationState;

async function render(initial: GenerationState) {
  await act(async () => {
    root.render(<Harness initial={initial} onState={(value) => { latest = value; }} />);
  });
}

async function renderLifecycle() {
  await act(async () => {
    root.render(<LifecycleHarness onState={(value) => { latest = value; }} />);
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function changeFeedback(value: string) {
  const input = container.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.saveSelection.mockResolvedValue({});
  api.reviseDrafts.mockResolvedValue({ generation_id: 55, drafts });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("DraftVariations feedback actions", () => {
  it("allows rejecting every draft and restarts from persisted empty selection", async () => {
    await render(state());
    expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe("Draft feedback");
    const restart = button("Start over from my intent");
    const review = button("Review");
    expect(restart.disabled).toBe(true);
    expect(review.disabled).toBe(true);

    await act(async () => changeFeedback("  Take a completely new angle  "));
    expect(restart.disabled).toBe(false);
    await act(async () => restart.click());

    expect(api.saveSelection).toHaveBeenCalledWith(55, [], "Take a completely new angle");
    expect(api.reviseDrafts).toHaveBeenCalledWith(55, "Take a completely new angle", "restart_from_intent");
  });

  it("revises selected drafts and resets selection from the server response", async () => {
    const revisedDrafts = [{ ...drafts[0], hook: "A revised hook" }, drafts[1], drafts[2]];
    api.reviseDrafts.mockResolvedValueOnce({ generation_id: 55, drafts: revisedDrafts });
    await render(state([0, 2]));
    await act(async () => changeFeedback("Make the sources sharper"));

    const revise = button("Generate 3 from your 2 included");
    await act(async () => revise.click());

    expect(api.saveSelection).toHaveBeenCalledWith(55, [0, 2], "Make the sources sharper");
    expect(api.reviseDrafts).toHaveBeenCalledWith(55, "Make the sources sharper", "revise_selected");
    expect(latest.drafts).toEqual(revisedDrafts);
    expect(latest.selectedDraftIndices).toEqual([]);
  });

  it("keeps blank feedback disabled without enabling combine for zero selection", async () => {
    await render(state());
    await act(async () => changeFeedback("   "));

    expect(button("Start over from my intent").disabled).toBe(true);
    expect(button("Review").disabled).toBe(true);
    expect(api.reviseDrafts).not.toHaveBeenCalled();
  });

  it("prevents a double click from starting duplicate paid requests", async () => {
    const pending = deferred<{ generation_id: number; drafts: typeof drafts }>();
    api.reviseDrafts.mockReturnValueOnce(pending.promise);
    await render(state());
    await act(async () => changeFeedback("Start fresh"));
    const restart = button("Start over from my intent");

    await act(async () => {
      restart.click();
      restart.click();
      await Promise.resolve();
    });
    expect(api.saveSelection).toHaveBeenCalledTimes(1);
    expect(api.reviseDrafts).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ generation_id: 55, drafts }));
  });

  it("shows the server error without losing drafts, selection, or feedback", async () => {
    api.reviseDrafts.mockRejectedValueOnce(new Error("provider unavailable"));
    const initial = state([1]);
    await render(initial);
    await act(async () => changeFeedback("Keep this direction"));
    await act(async () => button("Generate 3 from your 1 included").click());

    expect(container.textContent).toContain("provider unavailable");
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("provider unavailable");
    expect(alert?.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector("textarea")?.value).toBe("Keep this direction");
    expect(latest.drafts).toEqual(initial.drafts);
    expect(latest.selectedDraftIndices).toEqual([1]);
  });

  it("ignores a late success after reset/remount without clobbering a newer request", async () => {
    const oldRequest = deferred<{ generation_id: number; drafts: typeof drafts }>();
    const newRequest = deferred<{ generation_id: number; drafts: typeof drafts }>();
    api.reviseDrafts
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    await renderLifecycle();
    await act(async () => changeFeedback("Old request"));
    await act(async () => {
      button("Start over from my intent").click();
      await Promise.resolve();
    });

    await act(async () => button("Reset review").click());
    expect(container.querySelector("[data-shared-loading]")?.textContent).toBe("false");
    await act(async () => button("Remount review").click());
    await act(async () => changeFeedback("New request"));
    await act(async () => {
      button("Start over from my intent").click();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-shared-loading]")?.textContent).toBe("true");

    const staleDrafts = drafts.map((draft) => ({ ...draft, hook: `Stale ${draft.hook}` }));
    await act(async () => oldRequest.resolve({ generation_id: 55, drafts: staleDrafts }));

    expect(container.querySelector("[data-shared-loading]")?.textContent).toBe("true");
    expect(container.textContent).toContain("Loading drafts");
    expect(latest.authorIntent).toBe("A newer intent");
    expect(latest.drafts).toEqual(drafts);

    await act(async () => newRequest.resolve({ generation_id: 77, drafts }));
  });

  it("ignores a late failure after reset/remount without clobbering a newer request", async () => {
    const oldRequest = deferred<{ generation_id: number; drafts: typeof drafts }>();
    const newRequest = deferred<{ generation_id: number; drafts: typeof drafts }>();
    api.reviseDrafts
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    await renderLifecycle();
    await act(async () => changeFeedback("Old request"));
    await act(async () => {
      button("Start over from my intent").click();
      await Promise.resolve();
    });
    await act(async () => button("Reset review").click());
    await act(async () => button("Remount review").click());
    await act(async () => changeFeedback("New request"));
    await act(async () => {
      button("Start over from my intent").click();
      await Promise.resolve();
    });

    await act(async () => oldRequest.reject(new Error("stale provider failure")));

    expect(container.querySelector("[data-shared-loading]")?.textContent).toBe("true");
    expect(container.textContent).toContain("Loading drafts");
    expect(container.textContent).not.toContain("stale provider failure");
    expect(latest.authorIntent).toBe("A newer intent");

    await act(async () => newRequest.resolve({ generation_id: 77, drafts }));
  });
});
