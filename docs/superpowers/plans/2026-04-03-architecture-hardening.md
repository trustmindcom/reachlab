# Architecture Hardening & Code Quality Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate classes of bugs through architectural fixes (persona middleware, typed state, error boundaries), split oversized files, fix all critical/high issues from the architecture assessment.

**Architecture:** Six phases: (1) security middleware, (2) server file splits, (3) dashboard file splits + typing, (4) error handling, (5) cleanup + dead code, (6) testing & verification. Each phase produces a working, testable commit. Phases are ordered so earlier ones don't break later ones.

**Tech Stack:** TypeScript, Fastify, React, SQLite, Vitest

**Assessment reports:** `/tmp/perspectives/server-assessment.md`, `/tmp/perspectives/dashboard-assessment.md`, `/tmp/perspectives/infra-assessment.md`

---

## Chunk 1: Security — Persona Ownership Middleware

Eliminates the entire class of "forgot to check persona ownership" bugs.

### Task 1: Add persona ownership preHandler for generation routes

**Files:**
- Create: `server/src/middleware/persona-guard.ts`
- Modify: `server/src/routes/generate.ts`
- Modify: `server/src/utils.ts`
- Test: `server/src/__tests__/persona-guard.test.ts`

- [ ] **Step 1: Fix `getPersonaId` to throw on invalid input**

In `server/src/utils.ts`, `getPersonaId()` currently defaults to 1 for invalid input. Change it to throw a 400 error:

```typescript
export function getPersonaId(request: FastifyRequest): number {
  const raw = (request.query as any)?.persona_id ?? (request.headers["x-persona-id"] as string);
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error("Invalid or missing persona_id");
  }
  return id;
}
```

- [ ] **Step 2: Write tests for the persona guard**

```typescript
describe("persona ownership guard", () => {
  it("allows access when persona matches", async () => { /* ... */ });
  it("returns 403 when persona does not match", async () => { /* ... */ });
  it("skips non-parameterized routes", async () => { /* ... */ });
});
```

- [ ] **Step 3: Create persona-guard middleware**

```typescript
// server/src/middleware/persona-guard.ts
// Fastify preHandler that checks persona ownership for routes with :id param
// Works for /api/generate/history/:id/*, /api/generate/:id/*
// Looks up the generation by ID and checks gen.persona_id === getPersonaId(request)
```

- [ ] **Step 4: Register the guard on generate routes**

In `server/src/routes/generate.ts`, add the preHandler to all routes that take `:id` parameter. This replaces the per-route ownership checks (which can be removed).

- [ ] **Step 5: Remove redundant per-route ownership checks**

The individual `if (gen.persona_id !== personaId)` checks in each route become redundant. Remove them from: discard, delete, draft save, selection, chat, ghostwrite, retro routes. The middleware handles it.

- [ ] **Step 6: Run tests, type-check, commit**

Run: `pnpm test && npx tsc --noEmit --project server/tsconfig.json`

```bash
git commit -m "feat: persona ownership middleware — eliminates per-route auth checks"
```

### Task 2: Add persona guard to coach chat routes

**Files:**
- Modify: `server/src/routes/coach-chat.ts`

- [ ] **Step 1: Apply the same persona guard preHandler to coach chat session routes**

Routes with `:id` param (`/api/coach/chat/sessions/:id/messages`) should use the guard. The chat POST route already checks session ownership — verify it's consistent.

- [ ] **Step 2: Run tests, commit**

```bash
git commit -m "feat: apply persona guard to coach chat routes"
```

---

## Chunk 2: Server File Splits

Split the two largest files into focused modules. Each split is a pure refactor — no behavior changes, all existing tests must pass.

### Task 3: Split generate.ts (860 lines → 5 files)

**Files:**
- Create: `server/src/routes/generate-history.ts`
- Create: `server/src/routes/generate-retro.ts`
- Create: `server/src/routes/generate-rules.ts` (already partially exists)
- Modify: `server/src/routes/generate.ts` (shrinks to ~300 lines)
- Modify: `server/src/app.ts` (register new route files)

Split by domain:
- **generate.ts** — keeps: research, drafts, revise-drafts, combine, chat, ghostwrite, selection, draft-save
- **generate-history.ts** — list, detail, discard, delete endpoints
- **generate-retro.ts** — retro start, complete, pending, apply endpoints
- **generate-rules.ts** — already partially split; move remaining rule endpoints here

Each new file exports a `registerXRoutes(app, db)` function matching the existing pattern.

- [ ] **Step 1: Extract history routes to generate-history.ts**
- [ ] **Step 2: Extract retro routes to generate-retro.ts**
- [ ] **Step 3: Move remaining rule routes to generate-rules.ts**
- [ ] **Step 4: Register new route files in app.ts**
- [ ] **Step 5: Run ALL tests — must pass unchanged**
- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: split generate.ts into history, retro, rules route files"
```

### Task 4: Split generate-queries.ts (813 lines → 5 files)

**Files:**
- Create: `server/src/db/rule-queries.ts`
- Create: `server/src/db/message-queries.ts`
- Create: `server/src/db/retro-queries.ts`
- Create: `server/src/db/research-queries.ts`
- Modify: `server/src/db/generate-queries.ts` (shrinks to ~200 lines — generation CRUD + types)

Split by domain, matching the route splits:
- **generate-queries.ts** — generation CRUD, types (GenerationRecord, GenerationRule, etc.)
- **rule-queries.ts** — getRules, replaceAllRules, insertSingleRule, updateRule, softDeleteRule, seedDefaultRules, getMaxRuleSortOrder, getRuleCount, getAntiAiTropesEnabled
- **message-queries.ts** — insertGenerationMessage, getGenerationMessages, GenerationMessage type
- **retro-queries.ts** — startRetro, completeRetro, getRetroResult, getPendingRetros, markRetroApplied
- **research-queries.ts** — insertResearch, getResearch

Update all imports across the codebase. Every file that imported from `generate-queries.ts` needs to import from the right sub-module.

- [ ] **Step 1: Create rule-queries.ts with all rule functions**
- [ ] **Step 2: Create message-queries.ts with message functions**
- [ ] **Step 3: Create retro-queries.ts with retro functions**
- [ ] **Step 4: Create research-queries.ts with research functions**
- [ ] **Step 5: Update all imports across the codebase** — grep for every import from `generate-queries` and redirect to the right module. Key files: `ghostwriter-tools.ts`, `shared-tools.ts`, `ghostwriter.ts`, `coach-check.ts`, `auto-retro.ts`, `coaching-analyzer.ts`, all route files.
- [ ] **Step 6: Re-export from generate-queries.ts for backward compat** — temporarily re-export everything so any missed imports still work: `export * from "./rule-queries.js"` etc.
- [ ] **Step 7: Run ALL tests, type-check**
- [ ] **Step 8: Commit**

```bash
git commit -m "refactor: split generate-queries.ts into rule, message, retro, research query files"
```

---

## Chunk 3: Dashboard File Splits & Type Safety

### Task 5: Split api/client.ts (974 lines → 6 files)

**Files:**
- Create: `dashboard/src/api/types.ts`
- Create: `dashboard/src/api/analytics.ts`
- Create: `dashboard/src/api/generate.ts`
- Create: `dashboard/src/api/settings.ts`
- Create: `dashboard/src/api/coach.ts`
- Modify: `dashboard/src/api/client.ts` (shrinks to base helpers + re-exports)

- [ ] **Step 1: Extract all type interfaces to types.ts**
- [ ] **Step 2: Extract analytics/insights/overview methods to analytics.ts**
- [ ] **Step 3: Extract generate/research/draft/ghostwrite methods to generate.ts**
- [ ] **Step 4: Extract settings/config methods to settings.ts**
- [ ] **Step 5: Extract coach chat methods to coach.ts**
- [ ] **Step 6: client.ts becomes the base** — exports `withPersonaId`, `getScoped`, `postScoped` helpers, and re-exports everything for backward compat: `export * from "./types.js"` etc.
- [ ] **Step 7: Type-check dashboard**
- [ ] **Step 8: Commit**

```bash
git commit -m "refactor: split api/client.ts into domain modules"
```

### Task 6: Type `setGen` properly — eliminate 50 `any` occurrences

**Files:**
- Modify: `dashboard/src/pages/Generate.tsx`
- Modify: `dashboard/src/pages/generate/DiscoveryView.tsx`
- Modify: `dashboard/src/pages/generate/DraftVariations.tsx`
- Modify: `dashboard/src/pages/generate/GhostwriterChat.tsx`
- Modify: `dashboard/src/pages/generate/PostRetro.tsx`
- Modify: `dashboard/src/pages/generate/CoachingSyncModal.tsx`

- [ ] **Step 1: Export GenerationState type from Generate.tsx**
- [ ] **Step 2: Define typed setter**: `type SetGen = React.Dispatch<React.SetStateAction<GenerationState>>;`
- [ ] **Step 3: Update all component interfaces** that take `setGen` to use `SetGen` instead of `(fn: (prev: any) => any) => void`
- [ ] **Step 4: Fix all `setGen((prev: any) =>` calls** to use `(prev) =>` (TypeScript infers the type from `SetGen`)
- [ ] **Step 5: Type-check** — fix any type errors that surface (this is the point — find the bugs)
- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: type setGen properly — eliminate 50 any occurrences in Generate pipeline"
```

### Task 7: Split large dashboard components

**Files:**
- Create: `dashboard/src/pages/settings/GeneralSettings.tsx`
- Create: `dashboard/src/pages/settings/ApiKeySettings.tsx`
- Create: `dashboard/src/pages/settings/DangerZone.tsx`
- Modify: `dashboard/src/pages/Settings.tsx` (shrinks to router/layout)
- Create: `dashboard/src/pages/coach/hooks/useCoachActions.ts`
- Create: `dashboard/src/pages/coach/hooks/useCoachInsights.ts`
- Create: `dashboard/src/pages/coach/hooks/useCoachDeepDive.ts`
- Modify: `dashboard/src/pages/Coach.tsx` (shrinks — state moves to hooks)

- [ ] **Step 1: Split Settings.tsx into 3 components** — each section becomes its own file
- [ ] **Step 2: Extract Coach data loading into custom hooks** — each hook handles its own fetch, loading, error state
- [ ] **Step 3: Coach.tsx becomes a thin layout** that composes hooks + tabs
- [ ] **Step 4: Type-check, commit**

```bash
git commit -m "refactor: split Settings and Coach into focused components/hooks"
```

---

## Chunk 4: Error Handling

### Task 8: Add ErrorBoundary component

**Files:**
- Create: `dashboard/src/components/ErrorBoundary.tsx`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Create ErrorBoundary** — class component (required for getDerivedStateFromError), shows a "Something went wrong" UI with a retry button
- [ ] **Step 2: Wrap each page in App.tsx** with `<ErrorBoundary>`
- [ ] **Step 3: Type-check, commit**

```bash
git commit -m "feat: add ErrorBoundary wrapping each page"
```

### Task 9: Fix silent error swallowing

**Files:**
- Modify: `server/src/routes/generate.ts` and sub-route files
- Modify: `server/src/app.ts`
- Modify: `dashboard/src/pages/Coach.tsx`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Server — grep for `.catch(() => {})` and `.catch(() => "")` across all server files**

Replace each with proper logging: `.catch(err => console.error("[Module] Operation failed:", err))`

- [ ] **Step 2: Dashboard — fix Coach.tsx silent data drops**

When API calls fail, set an error state that shows a toast/banner instead of silently returning empty arrays.

- [ ] **Step 3: Dashboard — fix App.tsx key config pretending to succeed**

When the key check API fails, show the actual error instead of assuming keys are configured.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "fix: replace silent error swallowing with proper logging and user feedback"
```

---

## Chunk 5: Cleanup & Dead Code

### Task 10: Remove dead code and fix small issues

**Files:**
- Modify: `server/src/ai/prompts.ts` (delete dead prompts)
- Modify: `server/src/db/generate-queries.ts` (move DEFAULT_RULES to seed file)
- Modify: `dashboard/src/pages/Posts.tsx` (fix fragment key)
- Delete: `reachlab.db`, `server/reachlab.db` (stray DB files)
- Modify: `.gitignore` (add `reachlab.db` pattern)
- Modify: `server/src/ai/image-downloader.ts` (add LinkedIn CDN URL check)
- Modify: `server/src/routes/generate.ts` (remove duplicated `getClient()`)

- [ ] **Step 1: Delete dead prompts** — read `server/src/ai/prompts.ts`, identify functions not imported anywhere (grep), delete them
- [ ] **Step 2: Fix Posts.tsx fragment key**
- [ ] **Step 3: Delete stray DB files, update .gitignore**
- [ ] **Step 4: Add LinkedIn CDN check to image downloader** — only allow URLs matching `media.licdn.com` or `media-exp*.licdn.com`
- [ ] **Step 5: Extract duplicated `getClient()` to a shared helper**
- [ ] **Step 6: Run tests, commit**

```bash
git commit -m "chore: cleanup dead code, fix fragment key, SSRF on image downloader, dedup getClient"
```

---

## Chunk 6: Testing & Verification

### Task 11: Add missing test coverage for new architecture

**Files:**
- Create: `server/src/__tests__/persona-guard.test.ts`
- Create: `server/src/__tests__/update-checker.test.ts`
- Modify: `server/src/__tests__/generate-routes.test.ts` (add persona ownership tests)

- [ ] **Step 1: Test persona guard middleware** — verify 403 on wrong persona, 200 on correct, passthrough on routes without :id
- [ ] **Step 2: Test generation delete endpoint** — verify persona check, message cleanup, 404 on missing
- [ ] **Step 3: Test update checker** — mock execAsync, verify status states
- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "test: add coverage for persona guard, delete endpoint, update checker"
```

### Task 12: Full regression verification

- [ ] **Step 1: Run all tests**: `pnpm test`
- [ ] **Step 2: Type-check both projects**: `npx tsc --noEmit --project server/tsconfig.json && npx tsc --noEmit --project dashboard/tsconfig.json`
- [ ] **Step 3: Start dev server**: `pnpm dev`
- [ ] **Step 4: Verify Overview page loads** — all KPIs, AI insights
- [ ] **Step 5: Verify Coach page loads** — all 3 tabs, coach chat panel
- [ ] **Step 6: Verify Generate flow** — discover topics, click one, see 3 takes, select, draft, ghostwriter chat
- [ ] **Step 7: Verify Settings page** — rules, sources, API keys
- [ ] **Step 8: Verify Generation History** — list, open, delete, discard
- [ ] **Step 9: Verify published post** — opens full-width, chat toggle, retro button
- [ ] **Step 10: Check browser console** — no uncaught errors, no React warnings

---

## Execution Order & Dependencies

```
Chunk 1 (Security)     → independent, do first
Chunk 2 (Server splits) → depends on Chunk 1 (guard references route files)
Chunk 3 (Dashboard)     → independent of Chunk 2, can parallel
Chunk 4 (Error handling) → after Chunk 3 (needs ErrorBoundary + typed components)
Chunk 5 (Cleanup)       → after Chunks 2-4 (references split files)
Chunk 6 (Testing)       → last, verifies everything
```

Chunks 2 and 3 can run in parallel (server and dashboard are independent).
