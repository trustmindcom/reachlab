/** @vitest-environment jsdom */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationState } from "../../Generate";

const api = vi.hoisted(() => ({
  generateDiscover: vi.fn(),
  startGeneration: vi.fn(),
  generateResearch: vi.fn(),
  generateDrafts: vi.fn(),
}));

vi.mock("../../../api/client", () => ({ api }));
vi.mock("../../Generate", () => ({}));
vi.mock("../components/ScannerLoader", () => ({ default: () => null }));

import DiscoveryView from "../DiscoveryView";

const topic = {
  label: "Visible ambient label",
  summary: "Ambient evidence summary",
  source_headline: "Source headline",
  source_url: "https://example.com/source",
  category_tag: "AI",
};

const story = {
  headline: "Supporting story",
  summary: "Supporting evidence summary",
  source: "Example",
  source_url: "https://example.com/story",
  age: "today",
  tag: "AI",
  angles: ["An operator angle"],
  is_stretch: false,
};

function state(overrides: Partial<GenerationState> = {}): GenerationState {
  return {
    authorIntent: "",
    discoveryTopics: [],
    researchId: null,
    stories: [],
    articleCount: 0,
    sourceCount: 0,
    selectedStoryIndex: null,
    generationId: null,
    drafts: [],
    selectedDraftIndices: [],
    combiningGuidance: "",
    personalConnection: "",
    draftLength: "medium",
    originalDraft: "",
    finalDraft: "",
    qualityGate: null,
    appliedInsights: [],
    chatMessages: [],
    ...overrides,
  };
}

function Harness({
  initial,
  onState,
  onStartOver = () => {},
  onLoadingCall = () => {},
  resetOnStartOver = false,
  onNext = () => {},
}: {
  initial: GenerationState;
  onState: (value: GenerationState) => void;
  onStartOver?: () => void;
  onLoadingCall?: (value: boolean) => void;
  resetOnStartOver?: boolean;
  onNext?: () => void;
}) {
  const [gen, setGen] = React.useState(initial);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => onState(gen), [gen, onState]);
  const updateLoading = (value: boolean) => {
    onLoadingCall(value);
    setLoading(value);
  };
  const startOver = () => {
    if (resetOnStartOver) setGen(state());
    onStartOver();
  };
  return <DiscoveryView gen={gen} setGen={setGen} loading={loading} setLoading={updateLoading} onNext={onNext} onStartOver={startOver} onUserActed={() => {}} />;
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

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function changeTextArea(value: string) {
  const input = container.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function personalConnectionInput(): HTMLTextAreaElement {
  const input = [...container.querySelectorAll("textarea")].find((item) => item.placeholder.includes("migrated off Heroku"));
  if (!input) throw new Error("Missing personal connection input");
  return input;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  sessionStorage.clear();
  api.generateDiscover.mockResolvedValue({ topics: [] });
  api.startGeneration.mockResolvedValue({ generation_id: 55 });
  api.generateResearch.mockResolvedValue({ research_id: 9, stories: [], article_count: 0, source_count: 0 });
  api.generateDrafts.mockResolvedValue({ generation_id: 55, drafts: [] });
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: () => ({ finished: Promise.resolve(), onfinish: null }),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: true })),
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("DiscoveryView intent-led cutover", () => {
  it("typed submit clears ambient state, starts a generation, and accepts zero evidence", async () => {
    await render(state({ discoveryTopics: [topic], researchId: 4, selectedStoryIndex: 0 }));
    changeTextArea("  Typed intent wins  ");

    await act(async () => button("Go").click());

    expect(api.startGeneration).toHaveBeenCalledWith("Typed intent wins");
    expect(api.generateResearch).toHaveBeenCalledWith(55, undefined, undefined);
    expect(latest).toMatchObject({
      authorIntent: "Typed intent wins",
      generationId: 55,
      discoveryTopics: null,
      researchId: 9,
      stories: [],
      selectedStoryIndex: null,
    });
    expect(button("Generate drafts").disabled).toBe(false);

    await act(async () => button("Generate drafts").click());
    expect(api.generateDrafts).toHaveBeenCalledWith(55, null, undefined, "medium");
  });

  it("keeps ambient source as evidence while blank guidance falls back to the visible label", async () => {
    await render(state({ discoveryTopics: [topic] }));
    const card = [...container.querySelectorAll("div")].find((item) => item.textContent?.includes(topic.label) && item.hasAttribute("data-card"))!;

    await act(async () => card.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => button("Write about this").click());

    expect(api.startGeneration).toHaveBeenCalledWith(topic.label);
    expect(api.generateResearch).toHaveBeenCalledWith(55, undefined, {
      summary: topic.summary,
      source_headline: topic.source_headline,
      source_url: topic.source_url,
    });
  });

  it("shows explicit failure commands but never claims retry for a restored early row", async () => {
    api.generateResearch.mockRejectedValueOnce(new Error("provider unavailable"));
    await render(state());
    changeTextArea("Intent that survives failure");
    await act(async () => button("Go").click());

    expect(button("Retry research")).toBeTruthy();
    expect(button("Generate from my intent")).toBeTruthy();

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(state({ generationId: 73, authorIntent: "Restored early intent" }));

    expect(container.querySelector("textarea")?.value).toBe("Restored early intent");
    expect([...container.querySelectorAll("button")].some((item) => item.textContent?.trim() === "Retry research")).toBe(false);
  });

  it("routes restored early-row start over through the parent reset flow", async () => {
    const onStartOver = vi.fn();
    await act(async () => {
      root.render(<Harness
        initial={state({ generationId: 73, authorIntent: "Restored early intent" })}
        onState={(value) => { latest = value; }}
        onStartOver={onStartOver}
      />);
    });

    await act(async () => button("Start over").click());
    expect(onStartOver).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")?.value).toBe("");
  });

  it("generates on Enter with zero evidence and no selected story", async () => {
    await render(state({
      generationId: 55,
      authorIntent: "Draft directly from this intent",
      researchId: 9,
      stories: [],
      selectedStoryIndex: null,
    }));

    await act(async () => {
      personalConnectionInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(api.generateDrafts).toHaveBeenCalledWith(55, null, undefined, "medium");
  });

  it("toggles the current story anchor back to all-supporting mode and drafts with null story index", async () => {
    await render(state({
      generationId: 55,
      authorIntent: "Use evidence without surrendering intent",
      researchId: 9,
      stories: [story],
      selectedStoryIndex: null,
    }));
    const storyButton = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(story.headline))!;

    await act(async () => storyButton.click());
    expect(latest.selectedStoryIndex).toBe(0);
    expect(storyButton.getAttribute("aria-pressed")).toBe("true");

    await act(async () => storyButton.click());
    expect(latest.selectedStoryIndex).toBeNull();
    expect(storyButton.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      personalConnectionInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(api.generateDrafts).toHaveBeenCalledWith(55, null, undefined, "medium");
  });

  it("does not launch a duplicate paid start while a typed submission is pending", async () => {
    const start = deferred<{ generation_id: number }>();
    api.startGeneration.mockReturnValueOnce(start.promise);
    await render(state());
    changeTextArea("One paid request only");

    await act(async () => button("Go").click());
    await act(async () => {
      container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(api.startGeneration).toHaveBeenCalledOnce();
    await act(async () => start.resolve({ generation_id: 55 }));
  });

  it("invalidates pending research on Start over without stale state or loading writes", async () => {
    const research = deferred<{ research_id: number; stories: Array<typeof story>; article_count: number; source_count: number }>();
    api.generateResearch.mockReturnValueOnce(research.promise);
    const onStartOver = vi.fn();
    const loadingCalls: boolean[] = [];
    await act(async () => {
      root.render(<Harness
        initial={state()}
        onState={(value) => { latest = value; }}
        onStartOver={onStartOver}
        onLoadingCall={(value) => loadingCalls.push(value)}
        resetOnStartOver
      />);
    });
    changeTextArea("Reset this in-flight request");
    await act(async () => button("Go").click());
    expect(api.generateResearch).toHaveBeenCalledOnce();

    await act(async () => button("Start over").click());
    expect(onStartOver).toHaveBeenCalledOnce();
    expect(latest.generationId).toBeNull();
    const callsAfterReset = loadingCalls.length;

    await act(async () => research.resolve({ research_id: 99, stories: [story], article_count: 1, source_count: 1 }));
    expect(latest).toMatchObject({ generationId: null, researchId: null, stories: [] });
    expect(loadingCalls).toHaveLength(callsAfterReset);
  });

  it.each([
    ["early", state({ generationId: 73, authorIntent: "Restored early intent" })],
    ["researched", state({ generationId: 74, authorIntent: "Restored researched intent", researchId: 12, stories: [story] })],
  ])("adopts an async %s restore and ignores late initial discovery", async (_label, restored) => {
    const discovery = deferred<{ topics: Array<typeof topic> }>();
    api.generateDiscover.mockReturnValueOnce(discovery.promise);
    const setGen = vi.fn();
    const setLoading = vi.fn();

    await act(async () => {
      root.render(<DiscoveryView gen={state({ discoveryTopics: null })} setGen={setGen} loading={false} setLoading={setLoading} onNext={() => {}} onStartOver={() => {}} onUserActed={() => {}} />);
    });
    expect(api.generateDiscover).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(<DiscoveryView gen={restored} setGen={setGen} loading={true} setLoading={setLoading} onNext={() => {}} onStartOver={() => {}} onUserActed={() => {}} />);
    });
    expect(setLoading).toHaveBeenLastCalledWith(false);
    await act(async () => {
      root.render(<DiscoveryView gen={restored} setGen={setGen} loading={false} setLoading={setLoading} onNext={() => {}} onStartOver={() => {}} onUserActed={() => {}} />);
    });
    if (restored.stories.length > 0) {
      expect(container.textContent).toContain(story.headline);
    } else {
      expect(container.querySelector("textarea")?.value).toBe(restored.authorIntent);
    }

    await act(async () => discovery.resolve({ topics: [topic] }));
    expect(setGen).not.toHaveBeenCalled();
  });

  it("does not overwrite an in-progress typed edit when an unrelated restore arrives", async () => {
    const setGen = vi.fn();
    const setLoading = vi.fn();
    await act(async () => {
      root.render(<DiscoveryView gen={state()} setGen={setGen} loading={false} setLoading={setLoading} onNext={() => {}} onStartOver={() => {}} onUserActed={() => {}} />);
    });
    await act(async () => changeTextArea("My in-progress intent"));

    await act(async () => {
      root.render(<DiscoveryView
        gen={state({ generationId: 73, authorIntent: "Unrelated restored intent" })}
        setGen={setGen}
        loading={false}
        setLoading={setLoading}
        onNext={() => {}}
        onStartOver={() => {}}
        onUserActed={() => {}}
      />);
    });

    expect(container.querySelector("textarea")?.value).toBe("My in-progress intent");
  });

  it("routes Back to topics through the canonical parent reset callback", async () => {
    const onStartOver = vi.fn();
    await act(async () => {
      root.render(<Harness
        initial={state({ generationId: 55, authorIntent: "Abandon me", researchId: 9, stories: [story] })}
        onState={(value) => { latest = value; }}
        onStartOver={onStartOver}
      />);
    });

    await act(async () => button("Back to topics").click());
    expect(onStartOver).toHaveBeenCalledOnce();
  });

  it.each(["success", "error"] as const)("ignores a late draft %s after Start over", async (outcome) => {
    const draft = deferred<{ generation_id: number; drafts: [] }>();
    api.generateDrafts.mockReturnValueOnce(draft.promise);
    const onNext = vi.fn();
    const loadingCalls: boolean[] = [];
    await act(async () => {
      root.render(<Harness
        initial={state({ generationId: 55, authorIntent: "Draft without evidence", researchId: 9 })}
        onState={(value) => { latest = value; }}
        onLoadingCall={(value) => loadingCalls.push(value)}
        resetOnStartOver
        onNext={onNext}
      />);
    });

    await act(async () => button("Generate drafts").click());
    expect(api.generateDrafts).toHaveBeenCalledOnce();
    await act(async () => button("Start over").click());
    const callsAfterReset = loadingCalls.length;

    if (outcome === "success") {
      await act(async () => draft.resolve({ generation_id: 55, drafts: [] }));
    } else {
      await act(async () => draft.reject(new Error("late draft failure")));
    }

    expect(latest).toMatchObject({ generationId: null, drafts: [] });
    expect(onNext).not.toHaveBeenCalled();
    expect(loadingCalls).toHaveLength(callsAfterReset);
    expect(container.textContent).not.toContain("late draft failure");
  });

  it("makes only one paid draft call for repeated Generate from my intent clicks", async () => {
    const draft = deferred<{ generation_id: number; drafts: [] }>();
    api.generateResearch.mockRejectedValueOnce(new Error("research failed"));
    api.generateDrafts.mockReturnValueOnce(draft.promise);
    await render(state());
    await act(async () => changeTextArea("Generate once after failure"));
    await act(async () => button("Go").click());

    const generateFromIntent = button("Generate from my intent");
    await act(async () => {
      generateFromIntent.click();
      generateFromIntent.click();
    });

    expect(api.generateDrafts).toHaveBeenCalledOnce();
    await act(async () => draft.resolve({ generation_id: 55, drafts: [] }));
  });

  it("releases parent loading on unmount and ignores the pending start after remount", async () => {
    const start = deferred<{ generation_id: number }>();
    api.startGeneration.mockReturnValueOnce(start.promise);
    const setGen = vi.fn();
    const loadingCalls: boolean[] = [];
    const setLoading = (value: boolean) => loadingCalls.push(value);
    await act(async () => {
      root.render(<DiscoveryView gen={state()} setGen={setGen} loading={false} setLoading={setLoading} onNext={() => {}} onStartOver={() => {}} onUserActed={() => {}} />);
    });
    await act(async () => changeTextArea("Unmount this pending start"));
    await act(async () => button("Go").click());
    expect(loadingCalls.at(-1)).toBe(true);

    await act(async () => {
      root.render(null);
      await Promise.resolve();
    });
    expect(loadingCalls.at(-1)).toBe(false);
    const stateCallsAfterUnmount = setGen.mock.calls.length;
    const loadingCallsAfterUnmount = loadingCalls.length;

    await act(async () => {
      root.render(<DiscoveryView gen={state()} setGen={setGen} loading={false} setLoading={setLoading} onNext={() => {}} onStartOver={() => {}} onUserActed={() => {}} />);
    });
    await act(async () => changeTextArea("Remounted flow is interactive"));
    expect(button("Go").disabled).toBe(false);

    await act(async () => start.resolve({ generation_id: 55 }));
    expect(setGen).toHaveBeenCalledTimes(stateCallsAfterUnmount);
    expect(loadingCalls).toHaveLength(loadingCallsAfterUnmount);
  });

  it("keeps one cold-cache discovery alive through StrictMode effect replay", async () => {
    const discovery = deferred<{ topics: Array<typeof topic> }>();
    api.generateDiscover.mockReturnValueOnce(discovery.promise);
    await act(async () => {
      root.render(
        <React.StrictMode>
          <Harness
            initial={state({ discoveryTopics: null })}
            onState={(value) => { latest = value; }}
          />
        </React.StrictMode>,
      );
    });
    expect(api.generateDiscover).toHaveBeenCalledOnce();

    await act(async () => discovery.resolve({ topics: [topic] }));

    expect(api.generateDiscover).toHaveBeenCalledOnce();
    expect(latest.discoveryTopics).toEqual([topic]);
  });
});
