# Intent-Led Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user's persisted intent control research, initial drafting, revision, and ghostwriter while deleting the brainstorm branch that currently competes with it.

**Architecture:** Promote the existing `generations` row to the early workflow owner by adding `author_intent` and creating it before AI work. Reuse the existing research, draft, and revise routes with generation-owned request contracts; do not add a second route family or project aggregate. One research orchestrator and one writing-context loader replace the current story-versus-topic prompt branches.

**Tech Stack:** TypeScript, Fastify, SQLite/better-sqlite3, React 19, Zod, Vitest, Perplexity Search API, Anthropic SDK.

---

## Scope And Delivery

This is a three-PR direct cutover:

```text
PR 1: Early owner + pure boundaries
                 |
                 v
PR 2: Research/draft/UI cutover + brainstorm deletion
                 |
                 v
PR 3: Restart/ghostwriter/run correlation + release proof
```

The PRs are sequential because all three touch `server/src/routes/generate.ts`. PR 1 is behavior-neutral: it adds storage and independently tested helpers. PR 2 changes the active backend contracts and dashboard together, so there is no deployed state in which the UI and server disagree. PR 3 completes the review and diagnostic behavior.

Non-goals:

- no `writing_projects` table or second workflow identity,
- no parallel generation-scoped endpoint family,
- no dual writes or historical backfill,
- no general route split or `Generate.tsx` rewrite,
- no publication, retro, coaching, source, rules, analytics, or extension changes,
- no generic Insights authorization or logging redesign,
- no destructive SQLite table rebuild to remove old nullable columns.

Before each PR, create an isolated worktree from fresh `origin/main`. Preserve the dirty primary checkout. Verify the next migration number before PR 1; the plan uses `033` because the current tree ends at `032`.

## Final File Shape

New focused modules:

- `server/src/ai/intent-research.ts`: direct search adapter plus recent-then-all-time orchestration.
- `server/src/ai/writing-context.ts`: load and render server-owned intent plus optional evidence.
- `dashboard/src/pages/generate/generationFlow.ts`: small pure UI decisions used by `DiscoveryView` and tests.

Existing owners retained:

- `server/src/routes/generate.ts`: HTTP orchestration and persona authorization.
- `server/src/ai/drafter.ts`: draft and revision model calls.
- `server/src/db/generate-queries.ts`: generation persistence.
- `dashboard/src/pages/generate/DiscoveryView.tsx`: the existing discovery/composer experience.
- `dashboard/src/pages/generate/DraftVariations.tsx`: revise versus restart interaction.

Deleted active branch:

- `/api/generate/brainstorm`, `brainstormBody`, `brainstormAngles`, `generateApi.brainstormAngles`, and dashboard brainstorm state/rendering.

Historical `brainstorm_topic` and `brainstorm_angle` columns remain untouched. New code must not write them.

## PR 1: Establish The Early Owner And Shared Boundaries

**Dependencies:** none.

**Behavior:** No active dashboard behavior changes. The new helpers are dormant until PR 2.

**Files:**

- Create: `server/src/db/migrations/033-intent-led-generation.sql`
- Create: `server/src/ai/intent-research.ts`
- Create: `server/src/ai/writing-context.ts`
- Modify: `server/src/db/generate-queries.ts`
- Modify: `server/src/db/research-queries.ts`
- Modify: `server/src/routes/settings.ts`
- Modify: `CLAUDE.md`
- Test: `server/src/__tests__/generate-queries.test.ts`
- Test: `server/src/__tests__/intent-research.test.ts`
- Test: `server/src/__tests__/writing-context.test.ts`
- Test: `server/src/__tests__/settings-routes.test.ts`

### Task 1.1: Persist An Empty Generation Before AI Work

- [ ] Add failing query tests proving that a generation can exist with intent and without drafts:

```ts
it("starts a generation with canonical intent and no AI artifacts", () => {
  const id = startGeneration(db, 1, "  Build versus buy is an operating decision.  ");
  const row = getGeneration(db, id)!;

  expect(row.author_intent).toBe("Build versus buy is an operating decision.");
  expect(row.research_id).toBeNull();
  expect(row.drafts_json).toBeNull();
  expect(row.brainstorm_topic).toBeNull();
  expect(row.brainstorm_angle).toBeNull();
});

it("rejects blank intent", () => {
  expect(() => startGeneration(db, 1, "   ")).toThrow("Author intent is required");
});
```

- [ ] Run:

```bash
pnpm --filter linkedin-analytics-server test -- src/__tests__/generate-queries.test.ts
```

Expected: FAIL because `author_intent` and `startGeneration` do not exist.

- [ ] Create migration `033-intent-led-generation.sql`:

```sql
ALTER TABLE generations ADD COLUMN author_intent TEXT
  CHECK (author_intent IS NULL OR length(trim(author_intent)) > 0);

ALTER TABLE generation_research ADD COLUMN search_scope TEXT
  CHECK (search_scope IS NULL OR search_scope IN ('recent', 'all_time', 'anchor'));
ALTER TABLE generation_research ADD COLUMN recent_cutoff TEXT;

ALTER TABLE ai_runs ADD COLUMN generation_id INTEGER
  REFERENCES generations(id) ON DELETE SET NULL;
CREATE INDEX idx_ai_runs_generation ON ai_runs(generation_id, id);
```

- [ ] Extend `GenerationRecord` with `author_intent: string | null`. Change `insertGeneration` so `drafts_json` is optional, but keep existing callers valid.

- [ ] Add this focused constructor:

```ts
export function startGeneration(
  db: Database.Database,
  personaId: number,
  submittedIntent: string,
): number {
  const authorIntent = submittedIntent.trim();
  if (!authorIntent) throw new Error("Author intent is required");

  return Number(db.prepare(`
    INSERT INTO generations (persona_id, post_type, author_intent, status)
    VALUES (?, 'general', ?, 'draft')
  `).run(personaId, authorIntent).lastInsertRowid);
}
```

- [ ] Permit `updateGeneration` to update only the new-flow fields `research_id`, `selected_story_index`, `personal_connection`, and `draft_length` in addition to its existing allowlist. Do not add `author_intent` to the update allowlist.

- [ ] Re-run the query test and the real migration tests. Expected: PASS, including applying migrations through `032` and then `033` to a database containing an existing generation.

### Task 1.2: Add Recent-Then-All-Time Research As One Unit

- [ ] Write failing tests around an injected search adapter:

```ts
it("returns recent results without all-time fallback", async () => {
  const search = vi.fn().mockResolvedValueOnce([recentResult]);
  const result = await researchIntent({ intent, now, search, selectRelevant, synthesize });
  expect(search).toHaveBeenCalledTimes(1);
  expect(result.searchScope).toBe("recent");
});

it("falls back once when recent relevance is empty", async () => {
  const search = vi.fn()
    .mockResolvedValueOnce([irrelevantResult])
    .mockResolvedValueOnce([olderRelevantResult]);
  const result = await researchIntent({ intent, now, search, selectRelevant, synthesize });
  expect(search.mock.calls[0][0].after).toBe("05/10/2026");
  expect(search.mock.calls[1][0].after).toBeUndefined();
  expect(result.searchScope).toBe("all_time");
});

it("does not turn provider failure into all-time fallback", async () => {
  const search = vi.fn().mockRejectedValue(new Error("provider unavailable"));
  await expect(researchIntent({ intent, now, search, selectRelevant, synthesize }))
    .rejects.toThrow("provider unavailable");
  expect(search).toHaveBeenCalledTimes(1);
});
```

- [ ] Implement `searchPerplexity` in `intent-research.ts` using `POST https://api.perplexity.ai/search`, `PERPLEXITY_API_KEY`, and optional `search_after_date_filter`. Validate the response into structured `{ title, url, snippet, date, last_updated }` results before returning it.

- [ ] Implement `researchIntent` with injected `search`, `selectRelevant`, and `synthesize` dependencies. Calculate the cutoff with calendar-month subtraction, not `60 * 24` hours. Only a successful recent search plus zero relevant results can invoke the all-time search.

- [ ] Strictly validate synthesis as one to three complete `Story` objects. If relevant pages exist but synthesis is malformed or empty, throw; do not persist no-evidence and do not fall back.

- [ ] Extend `insertResearch` and its return type with:

```ts
search_scope: "recent" | "all_time" | "anchor";
recent_cutoff?: string | null;
```

- [ ] Add `PERPLEXITY_API_KEY` to the existing `CONFIGURABLE_KEYS` record in `server/src/routes/settings.ts`:

```ts
PERPLEXITY_API_KEY: {
  label: "Perplexity API Key",
  required: false,
  prefix: "pplx-",
  url: "https://www.perplexity.ai/settings/api",
},
```

- [ ] Add a focused settings-route test proving `GET /api/config/keys` exposes the Perplexity key without exposing its stored value and `PUT /api/config/keys` accepts it through the existing writer. Add `PERPLEXITY_API_KEY` to the environment table in `CLAUDE.md`; verify the already-present README setup example remains accurate. Do not add another settings route or UI component.

- [ ] Run:

```bash
pnpm --filter linkedin-analytics-server test -- src/__tests__/intent-research.test.ts src/__tests__/researcher.test.ts src/__tests__/settings-routes.test.ts
npx tsc --noEmit --project server/tsconfig.json
```

Expected: PASS.

### Task 1.3: Add One Server-Owned Writing Context

- [ ] Write failing tests for `loadWritingContext` and `renderWritingContext`:

```ts
it("renders intent before optional evidence", () => {
  const rendered = renderWritingContext({
    generationId: 42,
    authorIntent: "Security review should change the relationship, not document it.",
    anchorEvidence: storyA,
    supportingEvidence: [storyB],
  });

  expect(rendered.indexOf("AUTHOR INTENT - CONTROLLING"))
    .toBeLessThan(rendered.indexOf("ANCHOR EVIDENCE - FACTUAL CONTEXT ONLY"));
  expect(rendered).toContain("SUPPORTING EVIDENCE - MAY INFORM, MUST NOT REPLACE INTENT");
});

it("supports intent-only drafting", () => {
  const context = loadWritingContext(db, 1, intentOnlyGenerationId);
  expect(context.anchorEvidence).toBeNull();
  expect(context.supportingEvidence).toEqual([]);
});

it("rejects historical rows without intent", () => {
  expect(() => loadWritingContext(db, 1, legacyGenerationId))
    .toThrow("Generation has no author intent");
});
```

- [ ] Implement:

```ts
export interface WritingContext {
  generationId: number;
  authorIntent: string;
  anchorEvidence: Story | null;
  supportingEvidence: Story[];
}

export function loadWritingContext(
  db: Database.Database,
  personaId: number,
  generationId: number,
): WritingContext;

export function renderWritingContext(context: WritingContext): string;
```

The loader must verify persona ownership, require nonblank stored intent, parse the linked research once, treat `selected_story_index` as the optional anchor, and treat every other story as supporting evidence.

- [ ] Run:

```bash
pnpm --filter linkedin-analytics-server test -- src/__tests__/writing-context.test.ts src/__tests__/generate-queries.test.ts
npx tsc --noEmit --project server/tsconfig.json
```

Expected: PASS.

- [ ] Commit only PR 1 files:

```bash
git commit -m "refactor: establish intent-led generation boundaries"
```

## PR 2: Cut Over Research, Drafting, And The Dashboard

**Dependencies:** PR 1 merged and rebased onto fresh `origin/main`.

**Behavior:** This is the atomic product-flow cutover. Existing route paths remain, but their bodies become generation-owned. The dashboard changes in the same PR. The brainstorm path is deleted before merge.

**Files:**

- Modify: `server/src/schemas/generate.ts`
- Modify: `server/src/routes/generate.ts`
- Modify: `server/src/ai/drafter.ts`
- Modify: `server/src/ai/ghostwriter.ts`
- Modify: `server/src/ai/researcher.ts`
- Modify: `server/src/db/generate-queries.ts`
- Modify: `server/src/routes/generate-history.ts`
- Modify: `dashboard/src/api/generate.ts`
- Modify: `dashboard/src/api/types.ts`
- Modify: `dashboard/src/pages/Generate.tsx`
- Modify: `dashboard/src/pages/generate/DiscoveryView.tsx`
- Create: `dashboard/src/pages/generate/generationFlow.ts`
- Create: `dashboard/src/pages/generate/__tests__/generationFlow.test.ts`
- Test: `server/src/__tests__/generate-routes.test.ts`
- Test: `server/src/__tests__/drafter.test.ts`
- Test: `server/src/__tests__/ghostwriter.test.ts`

### Task 2.1: Change Existing Contracts In Place

- [ ] Replace the affected schemas with these shapes:

```ts
export const startGenerationBody = z.object({
  author_intent: z.string().trim().min(1).max(10_000),
});

export const researchBody = z.object({
  generation_id: z.number().int().positive(),
  avoid: z.array(z.string().max(500)).max(50).optional(),
  source_context: z.object({
    summary: z.string().max(2000),
    source_headline: z.string().max(500),
    source_url: z.string().max(2000),
  }).optional(),
});

export const draftsBody = z.object({
  generation_id: z.number().int().positive(),
  story_index: z.number().int().min(0).optional(),
  personal_connection: z.string().optional(),
  length: z.enum(["short", "medium", "long"]).optional(),
});
```

- [ ] Delete `brainstormBody`. Remove `topic`, `angle`, and caller-supplied `research_id` from the draft schema.

- [ ] Add route tests proving:

  - `/api/generate/start` stores canonical intent without constructing an AI client.
  - `/api/generate/research` loads intent from `generation_id` and rejects cross-persona access.
  - `/api/generate/drafts` works with no research, zero stories, all stories unselected, or one selected story.
  - invalid story indices return `400` without invoking the model.
  - drafting updates the original generation ID instead of inserting another row.

- [ ] Implement `/api/generate/start`. Change the existing `/api/generate/research` handler to use `generation_id`; for `source_context`, preserve anchored research but pass stored intent as the controlling message. For typed intent, call `researchIntent`.

- [ ] On successful research, insert one research row and update the same generation's `research_id`. On provider or synthesis failure, keep the generation and intent, create no research row, and return the existing error response.

- [ ] Change the existing `/api/generate/drafts` handler to load `WritingContext`, call `generateDrafts`, and update the same row with drafts, selected story, prompt snapshot, length, and personal connection.

- [ ] Change `getActiveGeneration` to include the newest nondiscarded intent-owned row even when `drafts_json` is null. Update the active-generation response and `Generate.tsx` restore mapping so an early row restores `generationId`, `authorIntent`, research, stories, and selected story without reconstructing brainstorm state. A restored row with no research offers `Generate from my intent` or `Start over`; it does not claim that anchored research can be retried without its missing source context.

- [ ] In `generate-history.ts`, use `author_intent` as the history headline when there is no selected story. Keep the existing brainstorm-angle fallback only for historical null-intent rows.

### Task 2.2: Make Draft Prompts Intent-First

- [ ] Replace `DraftContext = Story | { topic; angle }` with the rendered writing context:

```ts
export async function generateDrafts(
  client: Anthropic,
  db: Database.Database,
  personaId: number,
  logger: AiLogger,
  context: WritingContext,
  personalConnection?: string,
  length?: DraftLength,
): Promise<DraftResult>;
```

- [ ] Add prompt tests proving the exact stored intent appears under `AUTHOR INTENT - CONTROLLING`, a selected story appears only under anchor evidence, no selection includes all stories only as supporting evidence, and zero evidence still produces a valid prompt.

- [ ] Run:

```bash
pnpm --filter linkedin-analytics-server test -- src/__tests__/generate-routes.test.ts src/__tests__/drafter.test.ts src/__tests__/writing-context.test.ts src/__tests__/intent-research.test.ts
```

Expected: PASS.

### Task 2.3: Move Every Active Writer To Stored Intent

- [ ] Before declaring the cutover deployable, change the existing selected-draft revision handler to load `WritingContext` and pass it into `reviseDrafts`. Keep the current request body and selection requirement in PR 2; PR 3 adds restart mode.

- [ ] Change the selected-revision prompt so stored intent appears before the selected draft bodies and feedback. Add a test proving revision cannot run for a null-intent generation and cannot accept a caller-supplied replacement topic.

- [ ] Replace the story-or-brainstorm reconstruction in `/api/generate/ghostwrite` with `loadWritingContext` and `renderWritingContext`. Preserve ghostwriter tools, agent-loop behavior, message storage, and current-draft handling.

- [ ] Add an intermediate-head route test covering all active model-writing paths after PR 2: initial draft, revise selected, and ghostwriter. For each, assert the provider input contains the stored intent under `AUTHOR INTENT - CONTROLLING`. This test is the deployability gate for PR 2.

### Task 2.4: Cut Over Existing Dashboard State

- [ ] Add and test these pure decisions in `generationFlow.ts`:

```ts
export function shouldClearAmbientSelection(submittedIntent: string): boolean {
  return submittedIntent.trim().length > 0;
}

export function canGenerateDrafts(state: {
  generationId: number | null;
  researchStatus: "idle" | "loading" | "ready" | "failed";
  allowIntentOnlyAfterFailure: boolean;
}): boolean {
  return state.generationId !== null
    && state.researchStatus !== "loading"
    && (state.researchStatus !== "failed" || state.allowIntentOnlyAfterFailure);
}
```

- [ ] Change `GenerationState` to retain `generationId`, `authorIntent`, `researchId`, `stories`, and nullable `selectedStoryIndex`. Remove `selectedTopic`, `brainstormAngles`, `brainstormTopic`, and `selectedAngle` from active state and initial state.

- [ ] Update `restoreGeneration` in `Generate.tsx` to read `author_intent` and to restore step 1 when `drafts_json` is null. Do not map historical `brainstorm_topic` or `brainstorm_angle` into new-flow state.

- [ ] Change `generateApi`:

```ts
startGeneration(authorIntent: string)
generateResearch(generationId: number, avoid?, sourceContext?)
generateDrafts(generationId: number, storyIndex: number | null, personalConnection?, length?)
```

- [ ] In `DiscoveryView`, typed submission must clear ambient cards and selection, call `startGeneration`, call research with the returned ID, and display returned stories as optional context. Generate remains enabled when no story is selected and when research succeeds with zero stories.

- [ ] On research failure, show two explicit commands: `Retry research` for same-session requests whose source context remains available, and `Generate from my intent` to proceed without research. Do not label a changed or unavailable anchored request as a retry.

- [ ] Ambient selection must derive editable intent from user guidance, falling back to the visible story label only when guidance is empty. The ambient source remains `source_context`, never the controlling intent.

### Task 2.5: Delete The Displaced Branch

- [ ] Delete in this PR:

  - `POST /api/generate/brainstorm`,
  - `brainstormBody`,
  - `brainstormAngles` and its response type,
  - `generateApi.brainstormAngles`,
  - brainstorm state and angle-picker rendering in `DiscoveryView`,
  - every new-flow write of `brainstorm_topic` or `brainstorm_angle`.

- [ ] Remove brainstorm parameters and SQL columns from `insertGeneration`, or delete `insertGeneration` if no production caller remains after the early-owner cutover. Historical columns stay in the table but no general-purpose writer may accept them.

- [ ] Prove no active writer remains:

```bash
rg -n "brainstormAngles|brainstormBody|/api/generate/brainstorm|brainstorm_topic|brainstorm_angle" server/src dashboard/src \
  -g '!server/src/db/migrations/029-brainstorm-angles.sql'
```

Expected: only historical record types/read-only display references may remain. Any route, schema, client call, model function, or insert/update is a blocker.

- [ ] Run:

```bash
pnpm --filter linkedin-analytics-server test
pnpm --filter linkedin-analytics-dashboard test
npx tsc --noEmit --project server/tsconfig.json
npx tsc --noEmit --project dashboard/tsconfig.json
```

Expected: PASS.

- [ ] Commit only PR 2 files:

```bash
git commit -m "feat: make generation follow author intent"
```

## PR 3: Add Restart, Reuse Context, And Prove The Release

**Dependencies:** PR 2 merged and rebased onto fresh `origin/main`.

**Behavior:** Users can reject every draft and give guidance. Writing runs become traceable to the generation with exact provider inputs, without redesigning Insights.

**Files:**

- Modify: `server/src/schemas/generate.ts`
- Modify: `server/src/routes/generate.ts`
- Modify: `server/src/ai/drafter.ts`
- Modify: `server/src/ai/agent-loop.ts`
- Modify: `server/src/db/ai/runs.ts`
- Modify: `dashboard/src/api/generate.ts`
- Modify: `dashboard/src/pages/generate/DraftVariations.tsx`
- Modify: `dashboard/src/pages/generate/reviseButtonLabel.ts`
- Test: `server/src/__tests__/generate-routes.test.ts`
- Test: `server/src/__tests__/logger-inputs.test.ts`
- Test: `server/src/__tests__/ai-queries.test.ts`
- Test: `dashboard/src/pages/generate/__tests__/reviseButtonLabel.test.ts`

`server/src/db/ai-queries.ts` is only the barrel export. Extend the existing implementation in `server/src/db/ai/runs.ts`; do not add another run-query module.

### Task 3.1: Make Revision Mode Explicit

- [ ] Change the request schema:

```ts
export const reviseDraftsBody = z.object({
  generation_id: z.number().int().positive(),
  feedback: z.string().trim().min(1).max(10_000),
  mode: z.enum(["revise_selected", "restart_from_intent"]),
});
```

- [ ] Add failing route and prompt tests:

  - `revise_selected` requires at least one valid selected index and includes only those drafts plus intent and feedback.
  - `restart_from_intent` requires zero selected indices and includes intent, evidence, and feedback.
  - restart prompt contains none of the rejected draft bodies.
  - a mode/selection mismatch returns `400` before creating an AI client.

- [ ] Split pure prompt builders in `drafter.ts`:

```ts
export function buildReviseSelectedPrompt(
  context: WritingContext,
  selectedDrafts: Draft[],
  feedback: string,
  length?: DraftLength,
): string;

export function buildRestartFromIntentPrompt(
  context: WritingContext,
  feedback: string,
  length?: DraftLength,
): string;
```

- [ ] Route both modes through `loadWritingContext`. Preserve the existing draft update and selection reset after success.

### Task 3.2: Let The UI Reject Every Draft

- [ ] Change the label helper and tests:

```ts
export function reviseButtonLabel(selectedCount: number): string {
  return selectedCount === 0
    ? "Start over from my intent"
    : `Generate 3 from your ${selectedCount} included`;
}
```

- [ ] Enable the feedback action whenever feedback is nonblank, regardless of selected count. Send `restart_from_intent` when zero drafts are selected and `revise_selected` otherwise.

- [ ] Keep combine/finalize disabled with zero selection. Only the feedback-driven restart command changes.

### Task 3.3: Correlate Only Touched Writing Runs And Preserve Exact Inputs

- [ ] Extend `createRun` compatibly:

```ts
export function createRun(
  db: Database.Database,
  personaId: number,
  triggeredBy: string,
  postCount: number,
  generationId: number | null = null,
): number;
```

- [ ] Supply `generationId` from the touched research, draft, revise, and ghostwriter handlers. Existing non-writing callers remain unchanged and store null.

- [ ] Include `generation_id` in the existing run-list query used for diagnostics. Do not add a new telemetry table, endpoint, event bus, or generic authorization change.

- [ ] Test that a failed and successful writing run can both be traced to the originating generation.

- [ ] For initial draft and revision logs, store the actual rendered context and provider message in `input_messages`; do not retain summary placeholders such as `Generate variation 1` or `Revise 2 drafts` as the only recorded input.

- [ ] For ghostwriter agent-loop logs, include the actual system prompt containing rendered writing context alongside the provider messages. Use the existing `ai_logs.input_messages` field; do not add a log table or payload subsystem.

- [ ] Add focused diagnostic tests that parse `input_messages` for draft, revision, and ghostwriter runs and assert the exact stored intent and evidence headings are present. The tests must also prove rejected draft text is absent from restart logs.

### Task 3.4: Release Verification

- [ ] Run focused server tests:

```bash
pnpm --filter linkedin-analytics-server test -- \
  src/__tests__/generate-queries.test.ts \
  src/__tests__/intent-research.test.ts \
  src/__tests__/writing-context.test.ts \
  src/__tests__/researcher.test.ts \
  src/__tests__/drafter.test.ts \
  src/__tests__/generate-routes.test.ts \
  src/__tests__/ghostwriter.test.ts \
  src/__tests__/logger-inputs.test.ts \
  src/__tests__/ai-queries.test.ts
```

- [ ] Run dashboard tests and both typechecks:

```bash
pnpm --filter linkedin-analytics-dashboard test
npx tsc --noEmit --project server/tsconfig.json
npx tsc --noEmit --project dashboard/tsconfig.json
```

- [ ] Run repository validation commands documented in `package.json` and `CLAUDE.md`. Expected: all required checks pass with zero new warnings.

- [ ] Manually verify these flows in the running application:

  1. Type intent, select no ambient story, receive recent related stories, select none, and generate.
  2. Type intent whose recent search has no relevant results and confirm one all-time fallback.
  3. Generate successfully with zero evidence.
  4. Select an ambient story, add guidance, and confirm guidance controls the drafts while the story remains evidence.
  5. Reject all drafts, enter guidance, and restart without rejected text in the request log.
  6. Select drafts and revise them normally.
  7. Open ghostwriter and confirm the run is correlated to the generation and begins with stored intent.

- [ ] Re-run the obsolete-writer scan from PR 2. Any active brainstorm writer or topic/angle request branch blocks release.

- [ ] Commit only PR 3 files:

```bash
git commit -m "feat: restart generation from author intent"
```

## Final Acceptance Criteria

- The exact trimmed user input is persisted before any AI call.
- Typed intent clears ambient suggestions and triggers recent-first, then all-time research only after a successful zero-relevance result.
- Selected stories are optional evidence and never replace intent.
- Drafting succeeds with no selection, zero evidence, or an explicit intent-only continuation after research failure.
- The same generation row owns intent, research, drafts, revision, editor, history, publication, and retro state.
- Initial draft, revise, restart, and ghostwriter all use `writing-context.ts`.
- Users can mark every draft wrong and provide guidance without selecting a draft.
- The brainstorm endpoint, model call, client method, and active UI state are deleted.
- There is no second project ID, route family, frontend state framework, or generalized telemetry subsystem.
- Touched writing runs are traceable to the generation that produced the output.
- Full server/dashboard tests, typechecks, migration checks, and manual flow verification pass.
