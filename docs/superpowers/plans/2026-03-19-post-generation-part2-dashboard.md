# Post Generation — Dashboard Implementation Plan (Part 2 of 2)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dashboard UI for the post generation pipeline: Generate page with 3-step flow, Rules management, Generation History, and Weekly Coaching Sync modal.

**Architecture:** New Generate page with sub-tab state management. Pipeline flows through StorySelection → DraftVariations → ReviewEdit with local state. Rules and History are separate sub-tabs. Coaching Sync is a modal overlay. All data fetched from /api/generate/* endpoints built in Part 1.

**Tech Stack:** React 19, Tailwind CSS v4, TypeScript, Vite

**Depends on:** Part 1 (Server — routes must exist)

---

## File Structure

- **Modify:** `dashboard/src/App.tsx` — add "Generate" tab
- **Modify:** `dashboard/src/api/client.ts` — add generate API methods
- **Modify:** `dashboard/src/index.css` — add Newsreader/Satoshi font imports and generate-specific utilities
- **Create:** `dashboard/src/pages/Generate.tsx` — top-level page with sub-tab state
- **Create:** `dashboard/src/pages/generate/SubTabBar.tsx` — Generate/Rules/History sub-tabs
- **Create:** `dashboard/src/pages/generate/StorySelection.tsx` — Step 1: story cards + post type pills
- **Create:** `dashboard/src/pages/generate/DraftVariations.tsx` — Step 2: sidebar + reading area
- **Create:** `dashboard/src/pages/generate/ReviewEdit.tsx` — Step 3: editor + quality gate sidebar
- **Create:** `dashboard/src/pages/generate/Rules.tsx` — Rules sub-tab with 3 accordion sections
- **Create:** `dashboard/src/pages/generate/GenerationHistory.tsx` — History sub-tab
- **Create:** `dashboard/src/pages/generate/CoachingSyncModal.tsx` — Weekly sync modal
- **Create:** `dashboard/src/pages/generate/components/StoryCard.tsx`
- **Create:** `dashboard/src/pages/generate/components/DraftSidebar.tsx`
- **Create:** `dashboard/src/pages/generate/components/DraftReader.tsx`
- **Create:** `dashboard/src/pages/generate/components/QualityGateCard.tsx`
- **Create:** `dashboard/src/pages/generate/components/PostDetailsCard.tsx`
- **Create:** `dashboard/src/pages/generate/components/GuidanceAppliedCard.tsx`
- **Create:** `dashboard/src/pages/generate/components/RuleSection.tsx`
- **Create:** `dashboard/src/pages/generate/components/RuleItem.tsx`
- **Create:** `dashboard/src/pages/generate/components/CoachingChangeCard.tsx`

---

## Chunk 4: Dashboard Generate Pipeline UI

### Task 1: Add fonts, CSS utilities, and API client methods

**Files:**
- Modify: `dashboard/src/index.css`
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add Newsreader and Satoshi font imports + generate utilities to index.css**

Add at the top of `dashboard/src/index.css`, before `@import "tailwindcss";`:

```css
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap');
```

Add inside the `@theme` block, after `--font-mono`:

```css
  --font-serif: "Newsreader", Georgia, serif;
  --color-gen-accent: #6ba1f5;
  --color-gen-accent-soft: rgba(107, 161, 245, 0.12);
  --color-gen-accent-border: rgba(107, 161, 245, 0.25);
  --color-gen-bg-0: #09090b;
  --color-gen-bg-1: #0f0f12;
  --color-gen-bg-2: #151518;
  --color-gen-bg-3: #1c1c20;
  --color-gen-bg-4: #232328;
  --color-gen-text-0: #f5f5f7;
  --color-gen-text-1: #d1d1d6;
  --color-gen-text-2: #98989f;
  --color-gen-text-3: #6e6e76;
  --color-gen-text-4: #48484d;
  --color-gen-border-1: rgba(255, 255, 255, 0.055);
  --color-gen-border-2: rgba(255, 255, 255, 0.09);
  --color-gen-border-3: rgba(255, 255, 255, 0.14);
```

Add after the existing `.animate-fade-up` block:

```css
/* Generate page typography */
.font-serif-gen { font-family: var(--font-serif); }

/* Fade-up for draft reading area */
@keyframes fadeUpDraft {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-up-draft {
  animation: fadeUpDraft 0.3s ease both;
}
```

- [ ] **Step 2: Add generate types and API methods to client.ts**

Add these interfaces after the existing `HealthData` interface in `dashboard/src/api/client.ts`:

```typescript
// ── Generate Pipeline Types ─────────────────────────────────

export interface GenStory {
  headline: string;
  summary: string;
  source: string;
  age: string;
  tag: string;
  angles: string[];
  is_stretch: boolean;
}

export interface GenDraft {
  type: "contrarian" | "operator" | "future";
  hook: string;
  body: string;
  closing: string;
  word_count: number;
  structure_label: string;
}

export interface GenQualityCheck {
  name: string;
  status: "pass" | "warn";
  detail: string;
}

export interface GenQualityGate {
  passed: boolean;
  checks: GenQualityCheck[];
}

export interface GenResearchResponse {
  research_id: number;
  stories: GenStory[];
  article_count: number;
  source_count: number;
}

export interface GenDraftsResponse {
  generation_id: number;
  drafts: GenDraft[];
}

export interface GenCombineResponse {
  final_draft: string;
  quality_gate: GenQualityGate;
}

export interface GenReviseResponse {
  final_draft: string;
  quality_gate: GenQualityGate;
}

export interface GenRule {
  id?: number;
  rule_text: string;
  example_text?: string | null;
  sort_order: number;
}

export interface GenRulesResponse {
  categories: {
    voice_tone: GenRule[];
    structure_formatting: GenRule[];
    anti_ai_tropes: { enabled: boolean; rules: GenRule[] };
  };
}

export interface GenHistoryItem {
  id: number;
  hook_excerpt: string;
  story_headline: string;
  drafts_used: number;
  post_type: string;
  status: string;
  created_at: string;
}

export interface GenHistoryResponse {
  generations: GenHistoryItem[];
  total: number;
}

export interface GenCoachingChange {
  id: number;
  type: "new" | "updated" | "retire";
  title: string;
  evidence: string;
  old_text?: string;
  new_text?: string;
  insight_id?: number;
}

export interface GenCoachingSyncResponse {
  sync_id: number;
  changes: GenCoachingChange[];
}

export interface GenCoachingInsight {
  id: number;
  title: string;
  prompt_text: string;
  evidence: string | null;
  status: string;
}
```

Add these methods inside the `api` object, before the closing `}`:

```typescript
  // ── Generate Pipeline ─────────────────────────────────────

  generateResearch: (postType: string) =>
    fetch(`${BASE_URL}/generate/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_type: postType }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenResearchResponse>;
    }),

  generateDrafts: (researchId: number, storyIndex: number, postType: string) =>
    fetch(`${BASE_URL}/generate/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ research_id: researchId, story_index: storyIndex, post_type: postType }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenDraftsResponse>;
    }),

  generateCombine: (generationId: number, selectedDrafts: number[], combiningGuidance?: string) =>
    fetch(`${BASE_URL}/generate/combine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, selected_drafts: selectedDrafts, combining_guidance: combiningGuidance }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenCombineResponse>;
    }),

  generateRevise: (generationId: number, action: string, instruction?: string) =>
    fetch(`${BASE_URL}/generate/revise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, action, instruction }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenReviseResponse>;
    }),

  // ── Generate Rules ────────────────────────────────────────

  generateGetRules: () =>
    get<GenRulesResponse>("/generate/rules"),

  generateSaveRules: (categories: GenRulesResponse["categories"]) =>
    fetch(`${BASE_URL}/generate/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateResetRules: () =>
    fetch(`${BASE_URL}/generate/rules/reset`, { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenRulesResponse>;
    }),

  // ── Generate History ──────────────────────────────────────

  generateHistory: (status = "all", offset = 0, limit = 20) =>
    get<GenHistoryResponse>(`/generate/history?status=${status}&offset=${offset}&limit=${limit}`),

  generateHistoryDetail: (id: number) =>
    get<any>(`/generate/history/${id}`),

  generateDiscard: (id: number) =>
    fetch(`${BASE_URL}/generate/history/${id}/discard`, { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  // ── Coaching Sync ─────────────────────────────────────────

  generateCoachingAnalyze: () =>
    fetch(`${BASE_URL}/generate/coaching/analyze`, { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenCoachingSyncResponse>;
    }),

  generateCoachingDecide: (changeId: number, action: string, editedText?: string) =>
    fetch(`${BASE_URL}/generate/coaching/changes/${changeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, edited_text: editedText }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateCoachingHistory: () =>
    get<{ syncs: any[] }>("/generate/coaching/history"),

  generateCoachingInsights: () =>
    get<{ insights: GenCoachingInsight[] }>("/generate/coaching/insights"),
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/index.css dashboard/src/api/client.ts
git commit -m "feat: add generate pipeline types, API methods, and font/CSS utilities"
```

### Task 2: Add Generate tab to App.tsx and create SubTabBar

**Files:**
- Modify: `dashboard/src/App.tsx`
- Create: `dashboard/src/pages/Generate.tsx`
- Create: `dashboard/src/pages/generate/SubTabBar.tsx`

- [ ] **Step 1: Add Generate tab to App.tsx**

In `dashboard/src/App.tsx`, add the import:

```typescript
import Generate from "./pages/Generate";
```

Change the tabs array (line 10):

```typescript
const tabs = ["Overview", "Posts", "Coach", "Generate", "Timing", "Followers", "Settings"] as const;
```

Add the render case in the `<main>` block, after the Coach line:

```tsx
        {tab === "Generate" && <Generate />}
```

- [ ] **Step 2: Create SubTabBar.tsx**

Create `dashboard/src/pages/generate/SubTabBar.tsx`:

```tsx
const subTabs = ["Generate", "Rules", "History"] as const;
export type GenerateSubTab = (typeof subTabs)[number];

interface SubTabBarProps {
  active: GenerateSubTab;
  onChange: (tab: GenerateSubTab) => void;
}

export default function SubTabBar({ active, onChange }: SubTabBarProps) {
  return (
    <div className="border-b border-gen-border-2 -mx-6 px-8">
      <div className="flex gap-6">
        {subTabs.map((t) => (
          <button
            key={t}
            onClick={() => onChange(t)}
            className={`pb-2.5 pt-1 text-[13px] font-medium transition-colors relative ${
              active === t
                ? "text-gen-text-0"
                : "text-gen-text-3 hover:text-gen-text-1"
            }`}
          >
            {t}
            {active === t && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-gen-accent rounded-full" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create Generate.tsx skeleton**

Create `dashboard/src/pages/Generate.tsx`:

```tsx
import { useState } from "react";
import SubTabBar, { type GenerateSubTab } from "./generate/SubTabBar";
import StorySelection from "./generate/StorySelection";
import DraftVariations from "./generate/DraftVariations";
import ReviewEdit from "./generate/ReviewEdit";
import Rules from "./generate/Rules";
import GenerationHistory from "./generate/GenerationHistory";
import type {
  GenStory,
  GenDraft,
  GenQualityGate,
  GenCoachingInsight,
} from "../api/client";

interface GenerationState {
  researchId: number | null;
  generationId: number | null;
  postType: "news" | "topic" | "insight";
  stories: GenStory[];
  articleCount: number;
  sourceCount: number;
  selectedStoryIndex: number | null;
  drafts: GenDraft[];
  selectedDraftIndices: number[];
  combiningGuidance: string;
  finalDraft: string;
  qualityGate: GenQualityGate | null;
  appliedInsights: GenCoachingInsight[];
}

const initialState: GenerationState = {
  researchId: null,
  generationId: null,
  postType: "news",
  stories: [],
  articleCount: 0,
  sourceCount: 0,
  selectedStoryIndex: null,
  drafts: [],
  selectedDraftIndices: [],
  combiningGuidance: "",
  finalDraft: "",
  qualityGate: null,
  appliedInsights: [],
};

export default function Generate() {
  const [subTab, setSubTab] = useState<GenerateSubTab>("Generate");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [gen, setGen] = useState<GenerationState>(initialState);
  const [loading, setLoading] = useState(false);

  const resetPipeline = () => {
    setGen(initialState);
    setStep(1);
  };

  return (
    <div>
      <SubTabBar active={subTab} onChange={setSubTab} />

      <div className="mt-6">
        {subTab === "Generate" && step === 1 && (
          <StorySelection
            gen={gen}
            setGen={setGen}
            loading={loading}
            setLoading={setLoading}
            onNext={() => setStep(2)}
          />
        )}
        {subTab === "Generate" && step === 2 && (
          <DraftVariations
            gen={gen}
            setGen={setGen}
            loading={loading}
            setLoading={setLoading}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {subTab === "Generate" && step === 3 && (
          <ReviewEdit
            gen={gen}
            setGen={setGen}
            loading={loading}
            setLoading={setLoading}
            onBack={() => setStep(2)}
            onReset={resetPipeline}
          />
        )}
        {subTab === "Rules" && <Rules />}
        {subTab === "History" && <GenerationHistory onOpen={(id) => {
          // TODO: restore generation from history
          setSubTab("Generate");
        }} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify compilation (will fail — sub-pages don't exist yet, that's expected)**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: Import errors for missing sub-pages (resolved in next tasks)

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/App.tsx dashboard/src/pages/Generate.tsx dashboard/src/pages/generate/SubTabBar.tsx
git commit -m "feat: add Generate tab with sub-tab navigation and page skeleton"
```

### Task 3: Create StoryCard component

**Files:**
- Create: `dashboard/src/pages/generate/components/StoryCard.tsx`

- [ ] **Step 1: Write StoryCard.tsx**

Create `dashboard/src/pages/generate/components/StoryCard.tsx`:

```tsx
import type { GenStory } from "../../../api/client";

interface StoryCardProps {
  story: GenStory;
  index: number;
  selected: boolean;
  onSelect: () => void;
}

export default function StoryCard({ story, index, selected, onSelect }: StoryCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl p-5 transition-all border ${
        selected
          ? "border-gen-accent-border bg-gen-bg-2 shadow-[inset_3px_0_0_0_var(--color-gen-accent)]"
          : "border-gen-border-1 bg-gen-bg-1 hover:border-gen-border-2"
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Radio indicator */}
        <div className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
          selected ? "border-gen-accent bg-gen-accent" : "border-gen-text-4"
        }`}>
          {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>

        <div className="flex-1 min-w-0">
          {/* Headline */}
          <h3 className="font-serif-gen text-[19px] leading-snug text-gen-text-0 mb-2">
            {story.headline}
          </h3>

          {/* Summary */}
          <p className="text-[14px] text-gen-text-2 leading-relaxed mb-3">
            {story.summary}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-2 text-[12px]">
            <span className={`px-2 py-0.5 rounded-md font-medium ${
              selected
                ? "bg-gen-accent-soft text-gen-accent border border-gen-accent-border"
                : "bg-gen-bg-3 text-gen-text-3"
            }`}>
              {story.tag}
            </span>
            {story.is_stretch && (
              <span className="px-2 py-0.5 rounded-md font-medium bg-warning/10 text-warning border border-warning/20">
                STRETCH
              </span>
            )}
            <span className="text-gen-text-3">{story.source}</span>
            <span className="text-gen-text-4">{story.age}</span>
          </div>

          {/* Angles — only when selected */}
          {selected && story.angles.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gen-border-1">
              <p className="text-[12px] text-gen-text-3 font-medium mb-1">Possible angles</p>
              <ul className="text-[13px] text-gen-text-2 space-y-0.5">
                {story.angles.map((angle, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-gen-text-4 select-none">-</span>
                    <span>{angle}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/generate/components/StoryCard.tsx
git commit -m "feat: add StoryCard component for story selection step"
```

### Task 4: Create StorySelection page (Step 1)

**Files:**
- Create: `dashboard/src/pages/generate/StorySelection.tsx`

- [ ] **Step 1: Write StorySelection.tsx**

Create `dashboard/src/pages/generate/StorySelection.tsx`:

```tsx
import { useEffect } from "react";
import { api, type GenStory } from "../../api/client";
import StoryCard from "./components/StoryCard";

type PostType = "news" | "topic" | "insight";

interface StorySelectionProps {
  gen: {
    postType: PostType;
    stories: GenStory[];
    articleCount: number;
    sourceCount: number;
    researchId: number | null;
    selectedStoryIndex: number | null;
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onNext: () => void;
}

const postTypes: { value: PostType; label: string }[] = [
  { value: "news", label: "News" },
  { value: "topic", label: "Topic" },
  { value: "insight", label: "Insight" },
];

export default function StorySelection({ gen, setGen, loading, setLoading, onNext }: StorySelectionProps) {
  const doResearch = async (postType: PostType) => {
    setLoading(true);
    try {
      const res = await api.generateResearch(postType);
      setGen((prev: any) => ({
        ...prev,
        researchId: res.research_id,
        stories: res.stories,
        articleCount: res.article_count,
        sourceCount: res.source_count,
        selectedStoryIndex: null,
        postType,
      }));
    } catch (err) {
      console.error("Research failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // Auto-research on first mount if no stories
  useEffect(() => {
    if (gen.stories.length === 0 && !loading) {
      doResearch(gen.postType);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerateDrafts = async () => {
    if (gen.selectedStoryIndex === null || gen.researchId === null) return;
    setLoading(true);
    try {
      const res = await api.generateDrafts(gen.researchId, gen.selectedStoryIndex, gen.postType);
      setGen((prev: any) => ({
        ...prev,
        generationId: res.generation_id,
        drafts: res.drafts,
        selectedDraftIndices: [],
      }));
      onNext();
    } catch (err) {
      console.error("Draft generation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoPickAndGenerate = async () => {
    if (gen.researchId === null || gen.stories.length === 0) return;
    // Auto-pick: select the first non-stretch story, or first story
    const bestIndex = gen.stories.findIndex((s) => !s.is_stretch);
    const pickIndex = bestIndex >= 0 ? bestIndex : 0;
    setGen((prev: any) => ({ ...prev, selectedStoryIndex: pickIndex }));
    setLoading(true);
    try {
      const res = await api.generateDrafts(gen.researchId, pickIndex, gen.postType);
      setGen((prev: any) => ({
        ...prev,
        selectedStoryIndex: pickIndex,
        generationId: res.generation_id,
        drafts: res.drafts,
        selectedDraftIndices: [],
      }));
      onNext();
    } catch (err) {
      console.error("Draft generation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-[15px] font-medium text-gen-text-0">
          Pick a story to write about
        </h2>
        <div className="flex gap-1">
          {postTypes.map((pt) => (
            <button
              key={pt.value}
              onClick={() => doResearch(pt.value)}
              disabled={loading}
              className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors ${
                gen.postType === pt.value
                  ? "bg-gen-accent-soft text-gen-accent border border-gen-accent-border"
                  : "text-gen-text-3 hover:text-gen-text-1 border border-transparent"
              }`}
            >
              {pt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {loading && gen.stories.length === 0 && (
        <div className="flex items-center justify-center py-20 text-gen-text-3 text-[14px]">
          <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
          Researching stories...
        </div>
      )}

      {/* Story cards */}
      {gen.stories.length > 0 && (
        <div className="space-y-3">
          {gen.stories.map((story, i) => (
            <StoryCard
              key={i}
              story={story}
              index={i}
              selected={gen.selectedStoryIndex === i}
              onSelect={() =>
                setGen((prev: any) => ({ ...prev, selectedStoryIndex: i }))
              }
            />
          ))}
        </div>
      )}

      {/* Bottom bar */}
      {gen.stories.length > 0 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
          <div className="flex items-center gap-3">
            <button
              onClick={() => doResearch(gen.postType)}
              disabled={loading}
              className="text-[13px] text-gen-text-2 hover:text-gen-text-0 transition-colors disabled:opacity-50"
            >
              New research
            </button>
            <span className="text-[12px] text-gen-text-3">
              {gen.articleCount} articles from {gen.sourceCount} sources
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleAutoPickAndGenerate}
              disabled={loading}
              className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors disabled:opacity-50"
            >
              Auto-pick best match
            </button>
            <button
              onClick={handleGenerateDrafts}
              disabled={gen.selectedStoryIndex === null || loading}
              className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Generating..." : "Generate drafts"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/generate/StorySelection.tsx
git commit -m "feat: add StorySelection page — step 1 of generate pipeline"
```

### Task 5: Create DraftSidebar and DraftReader components

**Files:**
- Create: `dashboard/src/pages/generate/components/DraftSidebar.tsx`
- Create: `dashboard/src/pages/generate/components/DraftReader.tsx`

- [ ] **Step 1: Write DraftSidebar.tsx**

Create `dashboard/src/pages/generate/components/DraftSidebar.tsx`:

```tsx
import type { GenDraft } from "../../../api/client";

interface DraftSidebarProps {
  drafts: GenDraft[];
  activeDraft: number;
  selectedIndices: number[];
  onActivate: (index: number) => void;
  onToggleInclude: (index: number) => void;
}

const draftLabels: Record<string, string> = {
  contrarian: "Contrarian",
  operator: "Operator",
  future: "Future",
};

export default function DraftSidebar({
  drafts,
  activeDraft,
  selectedIndices,
  onActivate,
  onToggleInclude,
}: DraftSidebarProps) {
  return (
    <div className="w-[280px] flex-shrink-0 border-r border-gen-border-1 pr-5">
      <p className="text-[10px] uppercase tracking-[1.4px] text-gen-text-2 font-medium mb-4">
        Variations
      </p>
      <div className="space-y-1">
        {drafts.map((draft, i) => {
          const isActive = activeDraft === i;
          const isIncluded = selectedIndices.includes(i);
          return (
            <div key={i} className="relative">
              {/* Active indicator */}
              {isActive && (
                <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-gen-accent rounded-full" />
              )}
              <button
                onClick={() => onActivate(i)}
                className={`w-full text-left pl-4 pr-3 py-3 rounded-lg transition-colors ${
                  isActive ? "bg-gen-bg-2" : "hover:bg-gen-bg-2/50"
                }`}
              >
                <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-gen-bg-3 text-gen-text-2 mb-1.5">
                  {draftLabels[draft.type] || draft.type}
                </span>
                <p className="text-[13px] text-gen-text-1 leading-snug line-clamp-2">
                  {draft.hook}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] text-gen-text-3">{draft.word_count} words</span>
                  <label
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="text-[11px] text-gen-text-3">Include</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleInclude(i);
                      }}
                      className={`w-8 h-[18px] rounded-full transition-colors relative ${
                        isIncluded ? "bg-gen-accent" : "bg-gen-bg-3"
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                          isIncluded ? "translate-x-[16px]" : "translate-x-[2px]"
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write DraftReader.tsx**

Create `dashboard/src/pages/generate/components/DraftReader.tsx`:

```tsx
import type { GenDraft } from "../../../api/client";

interface DraftReaderProps {
  draft: GenDraft;
}

export default function DraftReader({ draft }: DraftReaderProps) {
  return (
    <div className="flex-1 px-11 py-10 animate-fade-up-draft" key={`${draft.type}-${draft.hook.slice(0, 20)}`}>
      {/* Hook */}
      <h2 className="font-serif-gen text-[26px] leading-[1.3] text-gen-text-0 mb-6">
        {draft.hook}
      </h2>

      {/* Body */}
      <div
        className="text-[15.5px] leading-[1.85] text-gen-text-1 whitespace-pre-line mb-6"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {draft.body}
      </div>

      {/* Closing */}
      <div className="border-t border-gen-border-1 pt-4">
        <p className="font-serif-gen italic text-[15.5px] text-gen-text-0 leading-relaxed">
          {draft.closing}
        </p>
      </div>

      {/* Meta */}
      <div className="mt-4 text-[13px] text-gen-text-2">
        <span className="font-semibold text-gen-text-1">{draft.word_count}</span> words
        <span className="mx-2 text-gen-text-4">|</span>
        {draft.structure_label}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/generate/components/DraftSidebar.tsx dashboard/src/pages/generate/components/DraftReader.tsx
git commit -m "feat: add DraftSidebar and DraftReader components for draft variations"
```

### Task 6: Create DraftVariations page (Step 2)

**Files:**
- Create: `dashboard/src/pages/generate/DraftVariations.tsx`

- [ ] **Step 1: Write DraftVariations.tsx**

Create `dashboard/src/pages/generate/DraftVariations.tsx`:

```tsx
import { useState } from "react";
import { api, type GenDraft } from "../../api/client";
import DraftSidebar from "./components/DraftSidebar";
import DraftReader from "./components/DraftReader";

interface DraftVariationsProps {
  gen: {
    generationId: number | null;
    drafts: GenDraft[];
    selectedDraftIndices: number[];
    combiningGuidance: string;
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function DraftVariations({ gen, setGen, loading, setLoading, onBack, onNext }: DraftVariationsProps) {
  const [activeDraft, setActiveDraft] = useState(0);

  const selectedCount = gen.selectedDraftIndices.length;
  const showGuidance = selectedCount >= 2;

  const handleToggleInclude = (index: number) => {
    setGen((prev: any) => {
      const current = prev.selectedDraftIndices as number[];
      const next = current.includes(index)
        ? current.filter((i: number) => i !== index)
        : [...current, index];
      return { ...prev, selectedDraftIndices: next };
    });
  };

  const handleCombineAndReview = async () => {
    if (gen.generationId === null || selectedCount === 0) return;
    setLoading(true);
    try {
      const res = await api.generateCombine(
        gen.generationId,
        gen.selectedDraftIndices,
        showGuidance ? gen.combiningGuidance : undefined
      );
      setGen((prev: any) => ({
        ...prev,
        finalDraft: res.final_draft,
        qualityGate: res.quality_gate,
      }));
      onNext();
    } catch (err) {
      console.error("Combine failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const actionLabel = selectedCount <= 1 ? "Review" : "Combine & review";

  return (
    <div>
      <div className="flex min-h-[60vh]">
        {/* Sidebar */}
        <DraftSidebar
          drafts={gen.drafts}
          activeDraft={activeDraft}
          selectedIndices={gen.selectedDraftIndices}
          onActivate={setActiveDraft}
          onToggleInclude={handleToggleInclude}
        />

        {/* Reading area */}
        {gen.drafts[activeDraft] && (
          <DraftReader draft={gen.drafts[activeDraft]} />
        )}
      </div>

      {/* Combining guidance */}
      {showGuidance && (
        <div className="mt-4 px-1">
          <label className="text-gen-text-0 text-[13px] font-semibold block mb-2">
            Direction for combining
          </label>
          <textarea
            value={gen.combiningGuidance}
            onChange={(e) =>
              setGen((prev: any) => ({ ...prev, combiningGuidance: e.target.value }))
            }
            placeholder="e.g. Lead with the contrarian hook, use the operator's examples, close with the future angle..."
            className="w-full bg-gen-bg-2 border border-gen-border-2 rounded-lg px-4 py-3 text-[14px] text-gen-text-1 placeholder:text-gen-text-3 resize-none h-20 focus:outline-none focus:border-gen-accent-border"
          />
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
        <button
          onClick={onBack}
          className="text-[13px] text-gen-text-2 hover:text-gen-text-0 transition-colors"
        >
          Back to stories
        </button>
        <div className="flex items-center gap-3">
          {selectedCount > 0 && (
            <span className="px-2.5 py-0.5 rounded-md text-[12px] font-bold bg-gen-accent-soft text-gen-accent border border-gen-accent-border">
              {selectedCount}
            </span>
          )}
          <button
            onClick={handleCombineAndReview}
            disabled={selectedCount === 0 || loading}
            className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Processing..." : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/generate/DraftVariations.tsx
git commit -m "feat: add DraftVariations page — step 2 of generate pipeline"
```

### Task 7: Create Quality Gate, Post Details, and Guidance sidebar cards

**Files:**
- Create: `dashboard/src/pages/generate/components/QualityGateCard.tsx`
- Create: `dashboard/src/pages/generate/components/PostDetailsCard.tsx`
- Create: `dashboard/src/pages/generate/components/GuidanceAppliedCard.tsx`

- [ ] **Step 1: Write QualityGateCard.tsx**

Create `dashboard/src/pages/generate/components/QualityGateCard.tsx`:

```tsx
import type { GenQualityGate } from "../../../api/client";

interface QualityGateCardProps {
  gate: GenQualityGate;
}

export default function QualityGateCard({ gate }: QualityGateCardProps) {
  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-semibold text-gen-text-0">Quality gate</h4>
        <span
          className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
            gate.passed
              ? "bg-positive/10 text-positive border border-positive/20"
              : "bg-warning/10 text-warning border border-warning/20"
          }`}
        >
          {gate.passed ? "Passed" : "Warning"}
        </span>
      </div>
      <div className="space-y-2">
        {gate.checks.map((check) => (
          <div key={check.name} className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">
              {check.status === "pass" ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke="#34d399" strokeWidth="1.5" />
                  <path d="M4.5 7l1.5 1.5 3-3" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke="#fbbf24" strokeWidth="1.5" />
                  <path d="M7 4.5v3M7 9.5h.005" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <div>
              <p className="text-[12px] text-gen-text-1 font-medium">
                {check.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </p>
              <p className="text-[11px] text-gen-text-3 leading-snug">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write PostDetailsCard.tsx**

Create `dashboard/src/pages/generate/components/PostDetailsCard.tsx`:

```tsx
interface PostDetailsCardProps {
  storyHeadline: string;
  draftsUsed: string[];
  structureLabel: string;
  wordCount: number;
}

export default function PostDetailsCard({ storyHeadline, draftsUsed, structureLabel, wordCount }: PostDetailsCardProps) {
  const readTime = Math.max(1, Math.round(wordCount / 200));

  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">Post details</h4>
      <div className="space-y-2 text-[12px]">
        <div className="flex justify-between">
          <span className="text-gen-text-3">Story</span>
          <span className="text-gen-text-1 text-right max-w-[180px] truncate">{storyHeadline}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gen-text-3">Drafts used</span>
          <span className="text-gen-text-1">{draftsUsed.join(", ")}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gen-text-3">Structure</span>
          <span className="text-gen-text-1">{structureLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gen-text-3">Est. read time</span>
          <span className="text-gen-text-1">{readTime} min</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write GuidanceAppliedCard.tsx**

Create `dashboard/src/pages/generate/components/GuidanceAppliedCard.tsx`:

```tsx
import type { GenCoachingInsight } from "../../../api/client";

interface GuidanceAppliedCardProps {
  insights: GenCoachingInsight[];
}

export default function GuidanceAppliedCard({ insights }: GuidanceAppliedCardProps) {
  if (insights.length === 0) return null;

  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">Guidance applied</h4>
      <div className="space-y-2.5">
        {insights.map((insight) => (
          <div
            key={insight.id}
            className="pl-3 border-l-2 border-gen-accent text-[12px] text-gen-text-2 leading-relaxed"
          >
            <p className="text-gen-text-1 font-medium mb-0.5">{insight.title}</p>
            <p>{insight.prompt_text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/generate/components/QualityGateCard.tsx dashboard/src/pages/generate/components/PostDetailsCard.tsx dashboard/src/pages/generate/components/GuidanceAppliedCard.tsx
git commit -m "feat: add QualityGateCard, PostDetailsCard, and GuidanceAppliedCard sidebar components"
```

### Task 8: Create ReviewEdit page (Step 3)

**Files:**
- Create: `dashboard/src/pages/generate/ReviewEdit.tsx`

- [ ] **Step 1: Write ReviewEdit.tsx**

Create `dashboard/src/pages/generate/ReviewEdit.tsx`:

```tsx
import { useState, useRef, useEffect } from "react";
import { api, type GenDraft, type GenQualityGate, type GenCoachingInsight, type GenStory } from "../../api/client";
import QualityGateCard from "./components/QualityGateCard";
import PostDetailsCard from "./components/PostDetailsCard";
import GuidanceAppliedCard from "./components/GuidanceAppliedCard";

interface ReviewEditProps {
  gen: {
    generationId: number | null;
    finalDraft: string;
    qualityGate: GenQualityGate | null;
    drafts: GenDraft[];
    selectedDraftIndices: number[];
    stories: GenStory[];
    selectedStoryIndex: number | null;
    appliedInsights: GenCoachingInsight[];
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onBack: () => void;
  onReset: () => void;
}

export default function ReviewEdit({ gen, setGen, loading, setLoading, onBack, onReset }: ReviewEditProps) {
  const [localDraft, setLocalDraft] = useState(gen.finalDraft);
  const [instruction, setInstruction] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync local draft when gen.finalDraft changes (from revisions)
  useEffect(() => {
    setLocalDraft(gen.finalDraft);
  }, [gen.finalDraft]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [localDraft]);

  const handleRevise = async (action: string, customInstruction?: string) => {
    if (!gen.generationId) return;
    setLoading(true);
    try {
      const res = await api.generateRevise(gen.generationId, action, customInstruction);
      setGen((prev: any) => ({
        ...prev,
        finalDraft: res.final_draft,
        qualityGate: res.quality_gate,
      }));
      setInstruction("");
    } catch (err) {
      console.error("Revise failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(localDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleOpenLinkedIn = async () => {
    await navigator.clipboard.writeText(localDraft);
    window.open("https://www.linkedin.com/feed/?shareActive=true", "_blank");
  };

  const wordCount = localDraft.split(/\s+/).filter(Boolean).length;
  const selectedDraftTypes = gen.selectedDraftIndices.map((i) => gen.drafts[i]?.type).filter(Boolean);
  const storyHeadline = gen.selectedStoryIndex !== null ? gen.stories[gen.selectedStoryIndex]?.headline || "" : "";
  const structureLabel = gen.drafts[gen.selectedDraftIndices[0]]?.structure_label || "";

  const quickActions = [
    { label: "Regenerate", action: "regenerate" },
    { label: "Shorten", action: "shorten" },
    { label: "Strengthen close", action: "strengthen_close" },
  ];

  return (
    <div>
      <div className="flex gap-6">
        {/* Editor panel */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={localDraft}
            onChange={(e) => setLocalDraft(e.target.value)}
            className="w-full bg-transparent text-[15.5px] leading-[1.85] text-gen-text-1 resize-none focus:outline-none min-h-[300px]"
            style={{ fontFamily: "var(--font-sans)" }}
          />

          {/* Quick action buttons */}
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gen-border-1">
            {quickActions.map((qa) => (
              <button
                key={qa.action}
                onClick={() => handleRevise(qa.action)}
                disabled={loading}
                className="px-3.5 py-1.5 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[13px] rounded-lg hover:border-gen-border-3 transition-colors disabled:opacity-50"
              >
                {qa.label}
              </button>
            ))}
            <span className="ml-auto text-[12px] text-gen-text-3">
              {wordCount} words
            </span>
          </div>

          {/* Free-text instruction */}
          <div className="flex gap-2 mt-3">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && instruction.trim()) {
                  handleRevise("custom", instruction.trim());
                }
              }}
              placeholder="Tell the AI what to change..."
              className="flex-1 bg-gen-bg-2 border border-gen-border-2 rounded-lg px-4 py-2.5 text-[13px] text-gen-text-1 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent-border"
            />
            <button
              onClick={() => {
                if (instruction.trim()) handleRevise("custom", instruction.trim());
              }}
              disabled={!instruction.trim() || loading}
              className="px-4 py-2.5 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[13px] rounded-lg hover:border-gen-border-3 transition-colors disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-[320px] flex-shrink-0 space-y-4">
          {gen.qualityGate && <QualityGateCard gate={gen.qualityGate} />}
          <PostDetailsCard
            storyHeadline={storyHeadline}
            draftsUsed={selectedDraftTypes}
            structureLabel={structureLabel}
            wordCount={wordCount}
          />
          <GuidanceAppliedCard insights={gen.appliedInsights} />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
        <button
          onClick={onBack}
          className="text-[13px] text-gen-text-2 hover:text-gen-text-0 transition-colors"
        >
          Back to drafts
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[13px] font-medium rounded-[10px] hover:border-gen-border-3 transition-colors"
          >
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <button
            onClick={handleOpenLinkedIn}
            className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors"
          >
            Open in LinkedIn
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: May still fail if Rules/History not created — that's OK

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/generate/ReviewEdit.tsx
git commit -m "feat: add ReviewEdit page — step 3 with editor, quality gate, and sidebar"
```

---

## Chunk 5: Dashboard Rules & History

### Task 9: Create RuleItem and RuleSection components

**Files:**
- Create: `dashboard/src/pages/generate/components/RuleItem.tsx`
- Create: `dashboard/src/pages/generate/components/RuleSection.tsx`

- [ ] **Step 1: Write RuleItem.tsx**

Create `dashboard/src/pages/generate/components/RuleItem.tsx`:

```tsx
import { useState } from "react";
import type { GenRule } from "../../../api/client";

interface RuleItemProps {
  rule: GenRule;
  onUpdate: (ruleText: string, exampleText?: string) => void;
  onDelete: () => void;
}

export default function RuleItem({ rule, onUpdate, onDelete }: RuleItemProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(rule.rule_text);
  const [editExample, setEditExample] = useState(rule.example_text || "");
  const [hovered, setHovered] = useState(false);

  const handleSave = () => {
    if (editText.trim()) {
      onUpdate(editText.trim(), editExample.trim() || undefined);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="py-2 space-y-2">
        <input
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
          className="w-full bg-gen-bg-2 border border-gen-border-2 rounded-lg px-3 py-2 text-[13px] text-gen-text-1 focus:outline-none focus:border-gen-accent-border"
        />
        <input
          type="text"
          value={editExample}
          onChange={(e) => setEditExample(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder="Example (optional, italic)"
          className="w-full bg-gen-bg-2 border border-gen-border-1 rounded-lg px-3 py-2 text-[12px] text-gen-text-2 italic placeholder:text-gen-text-4 focus:outline-none focus:border-gen-accent-border"
        />
        <div className="flex gap-2">
          <button onClick={handleSave} className="text-[12px] text-gen-accent hover:underline">Save</button>
          <button onClick={() => setEditing(false)} className="text-[12px] text-gen-text-3 hover:underline">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-2 py-1.5 group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="text-gen-text-4 mt-0.5 select-none text-[13px]">-</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-gen-text-1 leading-relaxed">{rule.rule_text}</p>
        {rule.example_text && (
          <p className="text-[12px] text-gen-text-3 italic mt-0.5">{rule.example_text}</p>
        )}
      </div>
      {hovered && (
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={() => setEditing(true)} className="text-[11px] text-gen-text-3 hover:text-gen-text-1">Edit</button>
          <button onClick={onDelete} className="text-[11px] text-gen-text-3 hover:text-negative">Delete</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write RuleSection.tsx**

Create `dashboard/src/pages/generate/components/RuleSection.tsx`:

```tsx
import { useState } from "react";
import type { GenRule } from "../../../api/client";
import RuleItem from "./RuleItem";

interface RuleSectionProps {
  title: string;
  category: string;
  rules: GenRule[];
  defaultExpanded?: boolean;
  masterToggle?: { enabled: boolean; onToggle: (v: boolean) => void };
  onUpdateRule: (index: number, ruleText: string, exampleText?: string) => void;
  onDeleteRule: (index: number) => void;
  onAddRule: (ruleText: string) => void;
}

export default function RuleSection({
  title,
  category,
  rules,
  defaultExpanded = true,
  masterToggle,
  onUpdateRule,
  onDeleteRule,
  onAddRule,
}: RuleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [newRuleText, setNewRuleText] = useState("");

  const categoryLabel = title.toLowerCase().replace(/ & /g, " ").split(" ")[0];

  return (
    <div className="border border-gen-border-1 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-gen-bg-2 hover:bg-gen-bg-3 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[14px] font-medium text-gen-text-0">{title}</span>
          <span className="text-[12px] text-gen-text-3">{rules.length}</span>
        </div>
        {masterToggle && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              masterToggle.onToggle(!masterToggle.enabled);
            }}
            className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
              masterToggle.enabled ? "bg-gen-accent" : "bg-gen-bg-3"
            }`}
          >
            <span
              className={`absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                masterToggle.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </div>
        )}
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-5 py-3">
          {rules.map((rule, i) => (
            <RuleItem
              key={`${category}-${i}`}
              rule={rule}
              onUpdate={(text, ex) => onUpdateRule(i, text, ex)}
              onDelete={() => onDeleteRule(i)}
            />
          ))}

          {/* Add rule input */}
          <div className="mt-3 pt-2 border-t border-gen-border-1">
            <input
              type="text"
              value={newRuleText}
              onChange={(e) => setNewRuleText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newRuleText.trim()) {
                  onAddRule(newRuleText.trim());
                  setNewRuleText("");
                }
              }}
              placeholder={`Add a ${categoryLabel} rule...`}
              className="w-full bg-transparent text-[13px] text-gen-text-2 placeholder:text-gen-text-4 focus:outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/generate/components/RuleItem.tsx dashboard/src/pages/generate/components/RuleSection.tsx
git commit -m "feat: add RuleItem and RuleSection components for writing rules management"
```

### Task 10: Create Rules page

**Files:**
- Create: `dashboard/src/pages/generate/Rules.tsx`

- [ ] **Step 1: Write Rules.tsx**

Create `dashboard/src/pages/generate/Rules.tsx`:

```tsx
import { useState, useEffect } from "react";
import { api, type GenRule, type GenRulesResponse } from "../../api/client";
import RuleSection from "./components/RuleSection";

interface RulesState {
  voice_tone: GenRule[];
  structure_formatting: GenRule[];
  anti_ai_tropes: { enabled: boolean; rules: GenRule[] };
}

export default function Rules() {
  const [rules, setRules] = useState<RulesState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.generateGetRules().then((res) => setRules(res.categories)).catch(console.error);
  }, []);

  const save = async (updated: RulesState) => {
    setRules(updated);
    setSaving(true);
    try {
      await api.generateSaveRules(updated);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await api.generateResetRules();
      setRules(res.categories);
    } catch (err) {
      console.error("Reset failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const makeHandlers = (category: "voice_tone" | "structure_formatting") => ({
    onUpdateRule: (index: number, ruleText: string, exampleText?: string) => {
      if (!rules) return;
      const updated = { ...rules };
      const arr = [...updated[category]];
      arr[index] = { ...arr[index], rule_text: ruleText, example_text: exampleText ?? null };
      updated[category] = arr;
      save(updated);
    },
    onDeleteRule: (index: number) => {
      if (!rules) return;
      const updated = { ...rules };
      updated[category] = updated[category].filter((_, i) => i !== index);
      save(updated);
    },
    onAddRule: (ruleText: string) => {
      if (!rules) return;
      const updated = { ...rules };
      updated[category] = [
        ...updated[category],
        { rule_text: ruleText, sort_order: updated[category].length },
      ];
      save(updated);
    },
  });

  const antiAiHandlers = {
    onUpdateRule: (index: number, ruleText: string, exampleText?: string) => {
      if (!rules) return;
      const updated = { ...rules };
      const arr = [...updated.anti_ai_tropes.rules];
      arr[index] = { ...arr[index], rule_text: ruleText, example_text: exampleText ?? null };
      updated.anti_ai_tropes = { ...updated.anti_ai_tropes, rules: arr };
      save(updated);
    },
    onDeleteRule: (index: number) => {
      if (!rules) return;
      const updated = { ...rules };
      updated.anti_ai_tropes = {
        ...updated.anti_ai_tropes,
        rules: updated.anti_ai_tropes.rules.filter((_, i) => i !== index),
      };
      save(updated);
    },
    onAddRule: (ruleText: string) => {
      if (!rules) return;
      const updated = { ...rules };
      updated.anti_ai_tropes = {
        ...updated.anti_ai_tropes,
        rules: [
          ...updated.anti_ai_tropes.rules,
          { rule_text: ruleText, sort_order: updated.anti_ai_tropes.rules.length },
        ],
      };
      save(updated);
    },
  };

  if (!rules) {
    return <div className="text-gen-text-3 text-[14px] py-10 text-center">Loading rules...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[17px] font-semibold text-gen-text-0">Writing rules</h2>
        <button
          onClick={handleReset}
          disabled={saving}
          className="text-[12px] text-gen-text-3 hover:text-gen-text-1 transition-colors disabled:opacity-50"
        >
          Reset to defaults
        </button>
      </div>
      <p className="text-[13px] text-gen-text-2 mb-6">
        Applied to every post you generate. Edit, delete, or add your own.
      </p>

      {/* Sections */}
      <div className="space-y-3">
        <RuleSection
          title="Voice & tone"
          category="voice_tone"
          rules={rules.voice_tone}
          defaultExpanded={true}
          {...makeHandlers("voice_tone")}
        />
        <RuleSection
          title="Structure & formatting"
          category="structure_formatting"
          rules={rules.structure_formatting}
          defaultExpanded={true}
          {...makeHandlers("structure_formatting")}
        />
        <RuleSection
          title="Anti-AI tropes"
          category="anti_ai_tropes"
          rules={rules.anti_ai_tropes.rules}
          defaultExpanded={false}
          masterToggle={{
            enabled: rules.anti_ai_tropes.enabled,
            onToggle: (v) => {
              const updated = {
                ...rules,
                anti_ai_tropes: { ...rules.anti_ai_tropes, enabled: v },
              };
              save(updated);
            },
          }}
          {...antiAiHandlers}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/generate/Rules.tsx
git commit -m "feat: add Rules page with accordion sections and inline editing"
```

### Task 11: Create GenerationHistory page

**Files:**
- Create: `dashboard/src/pages/generate/GenerationHistory.tsx`

- [ ] **Step 1: Write GenerationHistory.tsx**

Create `dashboard/src/pages/generate/GenerationHistory.tsx`:

```tsx
import { useState, useEffect } from "react";
import { api, type GenHistoryItem } from "../../api/client";

const statusFilters = ["all", "published", "draft", "discarded"] as const;
type StatusFilter = (typeof statusFilters)[number];

interface GenerationHistoryProps {
  onOpen: (id: number) => void;
}

export default function GenerationHistory({ onOpen }: GenerationHistoryProps) {
  const [items, setItems] = useState<GenHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const load = async (status: string, off: number) => {
    try {
      const res = await api.generateHistory(status, off, limit);
      if (off === 0) {
        setItems(res.generations);
      } else {
        setItems((prev) => [...prev, ...res.generations]);
      }
      setTotal(res.total);
    } catch (err) {
      console.error("Load history failed:", err);
    }
  };

  useEffect(() => {
    setOffset(0);
    load(filter, 0);
  }, [filter]);

  const handleDiscard = async (id: number) => {
    try {
      await api.generateDiscard(id);
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: "discarded" } : item))
      );
    } catch (err) {
      console.error("Discard failed:", err);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "published":
        return "bg-positive/10 text-positive border-positive/20";
      case "draft":
        return "bg-gen-bg-3 text-gen-text-2 border-gen-border-2";
      case "copied":
        return "bg-gen-accent-soft text-gen-accent border-gen-accent-border";
      case "discarded":
        return "bg-gen-bg-3 text-gen-text-4 border-gen-border-1";
      default:
        return "bg-gen-bg-3 text-gen-text-3 border-gen-border-2";
    }
  };

  return (
    <div>
      {/* Filter pills */}
      <div className="flex gap-1.5 mb-5">
        {statusFilters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors capitalize ${
              filter === f
                ? "bg-gen-accent-soft text-gen-accent border border-gen-accent-border"
                : "text-gen-text-3 hover:text-gen-text-1 border border-transparent"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div className="text-gen-text-3 text-[14px] py-10 text-center">
          No generations yet. Start by generating a post.
        </div>
      ) : (
        <div className="border border-gen-border-1 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gen-border-1 bg-gen-bg-2">
                <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-gen-text-3 font-medium">Post</th>
                <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-gen-text-3 font-medium w-[80px]">Type</th>
                <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-gen-text-3 font-medium w-[90px]">Status</th>
                <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-gen-text-3 font-medium w-[120px]">Date</th>
                <th className="w-[100px]" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gen-border-1 hover:bg-gen-bg-2/50 group">
                  <td className="px-4 py-3">
                    <p className="text-[13px] text-gen-text-1 leading-snug line-clamp-1">{item.hook_excerpt}</p>
                    <p className="text-[11px] text-gen-text-3 mt-0.5">
                      {item.story_headline} - {item.drafts_used} draft{item.drafts_used !== 1 ? "s" : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[12px] text-gen-text-2 capitalize">{item.post_type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border capitalize ${statusBadge(item.status)}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-gen-text-3">
                    {new Date(item.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onOpen(item.id)}
                        className="text-[11px] text-gen-accent hover:underline"
                      >
                        Open
                      </button>
                      {item.status !== "discarded" && (
                        <button
                          onClick={() => handleDiscard(item.id)}
                          className="text-[11px] text-gen-text-3 hover:text-negative"
                        >
                          Discard
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {items.length < total && (
        <div className="text-center mt-4">
          <button
            onClick={() => {
              const newOffset = offset + limit;
              setOffset(newOffset);
              load(filter, newOffset);
            }}
            className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors"
          >
            Showing {items.length} of {total} generations - Load more
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify full compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors (all referenced files now exist)

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/generate/GenerationHistory.tsx
git commit -m "feat: add GenerationHistory page with filter pills, table, and pagination"
```

---

## Chunk 6: Coaching Sync System

### Task 12: Create CoachingChangeCard component

**Files:**
- Create: `dashboard/src/pages/generate/components/CoachingChangeCard.tsx`

- [ ] **Step 1: Write CoachingChangeCard.tsx**

Create `dashboard/src/pages/generate/components/CoachingChangeCard.tsx`:

```tsx
import { useState } from "react";
import type { GenCoachingChange } from "../../../api/client";

interface CoachingChangeCardProps {
  change: GenCoachingChange;
  onDecide: (action: string, editedText?: string) => void;
}

const typeBadge: Record<string, string> = {
  new: "bg-gen-bg-3 text-gen-text-2",
  updated: "bg-gen-bg-3 text-gen-text-2",
  retire: "bg-gen-bg-3 text-gen-text-2",
};

export default function CoachingChangeCard({ change, onDecide }: CoachingChangeCardProps) {
  const [editedNewText, setEditedNewText] = useState(change.new_text || "");

  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2 py-0.5 rounded text-[11px] font-medium uppercase ${typeBadge[change.type] || typeBadge.new}`}>
          {change.type}
        </span>
        <h4 className="text-[14px] font-medium text-gen-text-0">{change.title}</h4>
      </div>

      {/* Evidence */}
      <p className="text-[12px] text-gen-text-2 mb-4 leading-relaxed">{change.evidence}</p>

      {/* Content blocks */}
      {change.type === "new" && (
        <div
          className="bg-gen-bg-1 border border-gen-border-2 rounded-lg p-3 border-l-[3px] border-l-positive"
        >
          <div
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => setEditedNewText(e.currentTarget.textContent || "")}
            className="text-[13px] text-gen-text-1 leading-relaxed focus:outline-none"
          >
            {change.new_text}
          </div>
        </div>
      )}

      {change.type === "updated" && (
        <div className="space-y-2">
          {/* Old text — red accent, not editable */}
          <div className="bg-gen-bg-1 border border-gen-border-2 rounded-lg p-3 border-l-[3px] border-l-negative">
            <p className="text-[13px] text-gen-text-3 leading-relaxed line-through">
              {change.old_text}
            </p>
          </div>
          {/* New text — green accent, editable */}
          <div className="bg-gen-bg-1 border border-gen-border-2 rounded-lg p-3 border-l-[3px] border-l-positive">
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => setEditedNewText(e.currentTarget.textContent || "")}
              className="text-[13px] text-gen-text-1 leading-relaxed focus:outline-none"
            >
              {change.new_text}
            </div>
          </div>
        </div>
      )}

      {change.type === "retire" && change.old_text && (
        <div className="bg-gen-bg-1 border border-gen-border-2 rounded-lg p-3 border-l-[3px] border-l-negative">
          <p className="text-[13px] text-gen-text-3 leading-relaxed">
            {change.old_text}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-4">
        {change.type === "retire" ? (
          <>
            <button
              onClick={() => onDecide("retire")}
              className="px-3.5 py-1.5 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-lg hover:bg-white transition-colors"
            >
              Retire
            </button>
            <button
              onClick={() => onDecide("keep")}
              className="px-3.5 py-1.5 text-gen-text-2 text-[13px] hover:text-gen-text-0 transition-colors"
            >
              Keep
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onDecide("accept", editedNewText || undefined)}
              className="px-3.5 py-1.5 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-lg hover:bg-white transition-colors"
            >
              Accept
            </button>
            <button
              onClick={() => onDecide("skip")}
              className="px-3.5 py-1.5 text-gen-text-2 text-[13px] hover:text-gen-text-0 transition-colors"
            >
              Skip
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/generate/components/CoachingChangeCard.tsx
git commit -m "feat: add CoachingChangeCard for NEW/UPDATED/RETIRE cards"
```

### Task 13: Create CoachingSyncModal

**Files:**
- Create: `dashboard/src/pages/generate/CoachingSyncModal.tsx`

- [ ] **Step 1: Write CoachingSyncModal.tsx**

Create `dashboard/src/pages/generate/CoachingSyncModal.tsx`:

```tsx
import { useState, useEffect } from "react";
import { api, type GenCoachingChange } from "../../api/client";
import CoachingChangeCard from "./components/CoachingChangeCard";

interface CoachingSyncModalProps {
  onClose: () => void;
  onViewHistory?: () => void;
}

export default function CoachingSyncModal({ onClose, onViewHistory }: CoachingSyncModalProps) {
  const [loading, setLoading] = useState(true);
  const [syncId, setSyncId] = useState<number | null>(null);
  const [changes, setChanges] = useState<GenCoachingChange[]>([]);
  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [page, setPage] = useState(0);

  const cardsPerPage = 2;
  const totalPages = Math.ceil(changes.length / cardsPerPage);
  const currentCards = changes.slice(page * cardsPerPage, (page + 1) * cardsPerPage);
  const acceptedCount = Object.values(decisions).filter((d) => d === "accept" || d === "retire").length;

  useEffect(() => {
    api
      .generateCoachingAnalyze()
      .then((res) => {
        setSyncId(res.sync_id);
        setChanges(res.changes);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDecide = async (changeId: number, action: string, editedText?: string) => {
    try {
      await api.generateCoachingDecide(changeId, action, editedText);
      setDecisions((prev) => ({ ...prev, [changeId]: action }));
    } catch (err) {
      console.error("Decision failed:", err);
    }
  };

  const allDecided = changes.length > 0 && changes.every((c) => decisions[c.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gen-bg-1 border border-gen-border-2 rounded-2xl w-full max-w-[640px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gen-border-1">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-semibold text-gen-text-0">Weekly coaching sync</h2>
              <p className="text-[13px] text-gen-text-2 mt-0.5">
                Review proposed changes to your coaching insights
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gen-text-3 hover:text-gen-text-0 transition-colors p-1"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-3 mt-2 text-[12px] text-gen-text-3">
            <span>Week of {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}</span>
            <span className="text-gen-text-4">·</span>
            {onViewHistory && (
              <button
                onClick={onViewHistory}
                className="text-gen-accent hover:underline"
              >
                View revision history
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gen-text-3 text-[14px]">
              Analyzing your coaching insights...
            </div>
          ) : changes.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-gen-text-3 text-[14px]">
              No changes proposed this week. Your coaching insights are looking good.
            </div>
          ) : (
            <div className="space-y-4">
              {currentCards.map((change) => (
                <CoachingChangeCard
                  key={change.id}
                  change={change}
                  onDecide={(action, editedText) => handleDecide(change.id, action, editedText)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gen-border-1 flex items-center justify-between">
          <span className="text-[12px] text-gen-text-3">
            {changes.length} proposed changes - {acceptedCount} accepted
          </span>
          <div className="flex items-center gap-3">
            {totalPages > 1 && (
              <>
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="text-[13px] text-gen-text-2 hover:text-gen-text-0 disabled:opacity-30 transition-colors"
                >
                  Previous
                </button>
                <span className="text-[12px] text-gen-text-3">
                  {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page === totalPages - 1}
                  className="text-[13px] text-gen-text-2 hover:text-gen-text-0 disabled:opacity-30 transition-colors"
                >
                  Next
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire CoachingSyncModal into Generate.tsx**

In `dashboard/src/pages/Generate.tsx`, add the import at the top:

```typescript
import CoachingSyncModal from "./generate/CoachingSyncModal";
```

Add state for the modal, after the `loading` state:

```typescript
  const [showCoachingSync, setShowCoachingSync] = useState(false);
```

Wrap the `<SubTabBar>` in a flex container and add a "Coaching sync" trigger button. Replace:

```tsx
      <SubTabBar active={subTab} onChange={setSubTab} />
```

with:

```tsx
      <div className="flex items-center justify-between">
        <SubTabBar active={subTab} onChange={setSubTab} />
        <button
          onClick={() => setShowCoachingSync(true)}
          className="text-[12px] text-gen-text-3 hover:text-gen-accent transition-colors"
        >
          Coaching sync
        </button>
      </div>
```

Add the modal render at the end of the return, just before the closing `</div>`:

```tsx
      {showCoachingSync && (
        <CoachingSyncModal onClose={() => setShowCoachingSync(false)} />
      )}
```

- [ ] **Step 3: Verify full compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/generate/CoachingSyncModal.tsx dashboard/src/pages/Generate.tsx
git commit -m "feat: add CoachingSyncModal with paginated coaching change cards"
```

---

## Chunk 7: Pre-populated Defaults & Polish

### Task 14: Update default writing rules seed data

**Files:**
- Modify: `server/src/db/generate-queries.ts` (the `DEFAULT_RULES` constant and `seedDefaultRules` function)

Part 1 defines a basic `DEFAULT_RULES` array in `generate-queries.ts`. Replace it with a richer set that includes favor/avoid examples from the Every.to AI Style Guide. The `seedDefaultRules()` function already uses this constant, and the `POST /api/generate/rules/reset` route already calls `seedDefaultRules()`, so no route changes are needed.

- [ ] **Step 1: Replace the `DEFAULT_RULES` constant in `server/src/db/generate-queries.ts`**

Replace the existing `DEFAULT_RULES` array with this expanded version. The `seedDefaultRules()` function and `replaceAllRules()` already handle the flat array format with `category`, `rule_text`, `example_text`, `sort_order` fields:

```typescript
export const DEFAULT_RULES: Array<{ category: string; rule_text: string; example_text?: string; sort_order: number }> = [
  // Voice & tone
  { category: "voice_tone", rule_text: "Favor concrete specifics over vague abstractions", example_text: 'Favor: "$400/month replacing $400k/year" — Avoid: "cost-effective solution"', sort_order: 0 },
  { category: "voice_tone", rule_text: "Favor embodied experience over generic descriptions", example_text: 'Favor: "I watched the deploy fail at 2am" — Avoid: "deployment issues can occur"', sort_order: 1 },
  { category: "voice_tone", rule_text: "Write with a practitioner voice, not an analyst voice", example_text: 'Favor: "Here\'s what I shipped" — Avoid: "Industry trends suggest"', sort_order: 2 },
  { category: "voice_tone", rule_text: "Use short, declarative sentences for impact. Long sentences for context.", sort_order: 3 },
  { category: "voice_tone", rule_text: "Sound like a person talking to a peer, not a brand talking to an audience", sort_order: 4 },
  // Structure & formatting
  { category: "structure_formatting", rule_text: "One idea per post. If you need a second idea, write a second post.", sort_order: 0 },
  { category: "structure_formatting", rule_text: "Open with friction, a claim, or a surprise — never with context or a question", example_text: 'Favor: "I fired our best engineer last month." — Avoid: "Have you ever wondered about team dynamics?"', sort_order: 1 },
  { category: "structure_formatting", rule_text: "Close with a process question that invites practitioner responses, not opinion questions", example_text: 'Favor: "What\'s your process for X?" — Avoid: "What do you think?"', sort_order: 2 },
  { category: "structure_formatting", rule_text: "End by extending the idea forward, never by summarizing or recapping", sort_order: 3 },
  { category: "structure_formatting", rule_text: "Use line breaks between every 1-2 sentences for mobile readability", sort_order: 4 },
  { category: "structure_formatting", rule_text: "Front-load the practical application, then provide theory if needed", sort_order: 5 },
  // Anti-AI tropes
  { category: "anti_ai_tropes", rule_text: "No hedge words: actually, maybe, just, perhaps, simply, basically, essentially, literally", sort_order: 0 },
  { category: "anti_ai_tropes", rule_text: 'No correlative constructions: "not X, but Y" / "less about X, more about Y"', example_text: 'Instead of "It\'s not about the tools, but the people" — just state the claim directly', sort_order: 1 },
  { category: "anti_ai_tropes", rule_text: "No rhetorical questions as filler or transitions between paragraphs", example_text: 'Remove: "But what does this really mean?" — just make the point', sort_order: 2 },
  { category: "anti_ai_tropes", rule_text: "No meandering introductions — start with the sharpest version of the claim", example_text: 'Avoid: "In today\'s rapidly evolving landscape..." — start with the insight', sort_order: 3 },
  { category: "anti_ai_tropes", rule_text: "No recapping conclusions that summarize what was already said", example_text: 'Avoid: "In summary..." or "The bottom line is..." — extend the idea instead', sort_order: 4 },
  { category: "anti_ai_tropes", rule_text: "No abstract industry analysis without personal stakes or experience", example_text: 'Avoid: "The AI industry is transforming..." — instead share what you built/broke/learned', sort_order: 5 },
  { category: "anti_ai_tropes", rule_text: "No process documentation without emotional arc or narrative tension", sort_order: 6 },
  { category: "anti_ai_tropes", rule_text: "No theory before practical application — lead with what happened, not why it matters conceptually", sort_order: 7 },
  { category: "anti_ai_tropes", rule_text: "No opening with historical context or background — open with friction or a claim", example_text: 'Avoid: "Over the past decade, the industry has seen..." — start with now', sort_order: 8 },
  { category: "anti_ai_tropes", rule_text: 'No "delve", "landscape", "paradigm shift", "leverage", "synergy", "unlock", "game-changer"', sort_order: 9 },
  { category: "anti_ai_tropes", rule_text: "No emoji-heavy formatting or numbered listicles disguised as thought leadership", sort_order: 10 },
];
```

This replaces the Part 1 `DEFAULT_RULES` array with a richer version. The existing `seedDefaultRules()` function calls `replaceAllRules(db, DEFAULT_RULES)` which already handles this format. The `POST /api/generate/rules/reset` route calls `seedDefaultRules()` — no route changes needed.

- [ ] **Step 2: Commit**

```bash
git add server/src/db/generate-queries.ts
git commit -m "feat: expand default writing rules with favor/avoid examples and anti-AI trope detection"
```

### Task 15: Define quality gate checklist items

**Files:**
- Modify: `server/src/ai/quality-gate.ts`

- [ ] **Step 1: Define quality gate check definitions**

Ensure the `quality-gate.ts` module uses these 6 checks in its assessment prompt. Add this constant near the top of the file:

```typescript
export const QUALITY_GATE_CHECKS = [
  {
    name: "voice_match",
    label: "Voice match",
    prompt: "Does the post sound like the author's established voice? Check against writing rules for tone, specificity, and sentence style.",
  },
  {
    name: "ai_tropes",
    label: "AI tropes",
    prompt: "Check for AI-generated writing patterns: hedge words, correlative constructions, rhetorical questions as filler, meandering intros, recapping conclusions, abstract analysis without stakes, theory before application, opening with context instead of friction.",
  },
  {
    name: "hook_strength",
    label: "Hook strength",
    prompt: "Does the hook open with friction, a claim, or a surprise? Fail if it opens with a question, context dump, historical background, or generic statement.",
  },
  {
    name: "engagement_close",
    label: "Engagement close",
    prompt: "Does the closing question invite informed practitioner responses? Fail if it's a generic opinion question ('What do you think?') or summarizes the post.",
  },
  {
    name: "concrete_specifics",
    label: "Concrete specifics",
    prompt: "Does the post use named tools, specific metrics, real experiences, or concrete examples? Fail if it relies on vague abstractions or generic industry analysis.",
  },
  {
    name: "ending_quality",
    label: "Ending quality",
    prompt: "Does the ending extend the idea forward or provoke new thinking? Fail if it summarizes, recaps, or restates the main point.",
  },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/quality-gate.ts
git commit -m "feat: define quality gate checklist with 6 assessment checks"
```

### Task 16: Define post type template refinements

**Files:**
- Modify: `server/src/db/migrations/009-generation.sql`

- [ ] **Step 1: Update the seed INSERT for post type templates with richer instructions**

Replace the existing `INSERT OR IGNORE INTO post_type_templates` block at the end of the migration:

```sql
-- Seed default post type templates (refined)
INSERT OR IGNORE INTO post_type_templates (post_type, template_text) VALUES
  ('news', 'Write a LinkedIn post reacting to a news story.

Structure:
- Hook: State a non-obvious take on the news in one punchy sentence. Do NOT start with the news itself.
- Context: 1-2 sentences on what happened (assume reader hasn''t seen it).
- Take: Your practitioner perspective — what this means for people who build/ship/operate. Use specific experience.
- Close: A process question that invites practitioners to share their approach.

Constraints:
- One take per post. Don''t hedge with "on one hand."
- Ground claims in what you''ve built, shipped, or observed — not industry analysis.
- 150-250 words. Every sentence earns its place.'),

  ('topic', 'Write a LinkedIn post exploring a professional topic from practitioner experience.

Structure:
- Hook: A surprising insight, counterintuitive claim, or friction point. Not a question.
- Setup: What you observed, built, or broke that led to this insight. Be specific.
- Expansion: One concrete example with named tools, metrics, or outcomes.
- Close: A question that triggers substantive practitioner responses about their process.

Constraints:
- Draw from direct experience, not secondhand analysis.
- One idea per post. If the outline has two ideas, pick the sharper one.
- 150-300 words. Favor short declarative sentences for impact.'),

  ('insight', 'Write a LinkedIn post sharing a hard-won professional insight.

Structure:
- Hook: The sharpest version of the lesson in one sentence. Lead with the conclusion.
- Story: The specific moment or experience that taught this lesson. Include sensory/emotional detail.
- Principle: The generalizable takeaway, grounded in the specific story.
- Close: A reflective question that makes other practitioners examine their own experience.

Constraints:
- The insight must come from direct experience, not observation or reading.
- Include at least one specific detail (a tool name, a dollar amount, a timeline, a failure mode).
- 150-250 words. The story should be tight — no scene-setting preamble.');
```

- [ ] **Step 2: Commit**

```bash
git add server/src/db/migrations/009-generation.sql
git commit -m "feat: refine post type templates with detailed structure and constraints"
```

### Task 17: Final verification and directory setup

- [ ] **Step 1: Create the generate components directory**

Run: `mkdir -p /Users/nate/code/linkedin/dashboard/src/pages/generate/components`

- [ ] **Step 2: Full type-check**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -40`
Expected: No errors

- [ ] **Step 3: Build dashboard**

Run: `cd /Users/nate/code/linkedin && npm run build --workspace=dashboard 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve any remaining type errors in generate pipeline UI"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Fonts, CSS, API client methods | `index.css`, `client.ts` |
| 2 | Generate tab + SubTabBar + page skeleton | `App.tsx`, `Generate.tsx`, `SubTabBar.tsx` |
| 3 | StoryCard component | `StoryCard.tsx` |
| 4 | StorySelection page (Step 1) | `StorySelection.tsx` |
| 5 | DraftSidebar + DraftReader components | `DraftSidebar.tsx`, `DraftReader.tsx` |
| 6 | DraftVariations page (Step 2) | `DraftVariations.tsx` |
| 7 | Quality gate + Post details + Guidance cards | `QualityGateCard.tsx`, `PostDetailsCard.tsx`, `GuidanceAppliedCard.tsx` |
| 8 | ReviewEdit page (Step 3) | `ReviewEdit.tsx` |
| 9 | RuleItem + RuleSection components | `RuleItem.tsx`, `RuleSection.tsx` |
| 10 | Rules page | `Rules.tsx` |
| 11 | GenerationHistory page | `GenerationHistory.tsx` |
| 12 | CoachingChangeCard component | `CoachingChangeCard.tsx` |
| 13 | CoachingSyncModal + wire into Generate | `CoachingSyncModal.tsx`, `Generate.tsx` |
| 14 | Default writing rules seed data | `generate-queries.ts` |
| 15 | Quality gate checklist definitions | `quality-gate.ts` |
| 16 | Post type template refinements | `009-generation.sql` |
| 17 | Final verification + build | All files |
