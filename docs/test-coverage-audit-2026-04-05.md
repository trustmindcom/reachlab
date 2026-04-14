# Test Coverage Audit — 2026-04-05

## Summary

| Section | Source files | Test files | Rough coverage |
|---|---|---|---|
| Server | 84 | 31 | ~55% of modules have a direct test |
| Dashboard | 67 | 1 | ~2% |
| Extension | 7 | 2 | ~28% |

## Section 1 — Server (server/src/)

### What IS covered
Route tests: `generate-routes`, `insights-routes`, `settings-routes`, `server`. DB: `queries`, `ai-queries`, `coach-chat-queries`, `generate-queries`. AI: `agent-loop`, `analyzer`, `client`, `orchestrator`, `pipeline-modules`, `prompts`, `tagger`, `coach-check`, `discovery`, `feed-discoverer`, `ghostwriter-tools`, `ghostwriter`, `image-classifier`, `image-downloader`, `perplexity`, `persona-guard`, `prompt-assembler`, `researcher`, `rss-fetcher`, `source-discoverer`, `stats-report`, `stream-with-idle`, `web-tools`.

### Gaps ranked by risk

**HIGH (mutates DB / handles auth / core pipeline)**
- `routes/ingest.ts` (399 LOC) — the hub route. No direct test. Touches every table and fans out to 4+ AI modules. Key scenarios missing: duplicate post-URN idempotency, partial payload handling, trigger cascade wiring.
- `db/rule-queries.ts` (240 LOC) — user-managed generation rules + auto rules coexistence. No test. Bulk-replace semantics for `origin='manual'` vs `origin='auto'`.
- `db/user-queries.ts` — auth token lookup, default user creation. No direct test.
- `db/persona-queries.ts` — persona CRUD, multi-persona scoping. No direct test.

**MEDIUM (read-only queries, validation, non-hub routes)**
- `routes/profile.ts` (142 LOC) — author profile CRUD.
- `routes/generate-sources.ts` (207 LOC) — POST/DELETE sources, feed validation wiring.
- `routes/generate-retro.ts` (134 LOC).
- `routes/generate-coaching.ts` (123 LOC).
- `routes/coach-chat.ts` (112 LOC) — route layer (queries are tested).
- `db/source-queries.ts`, `db/retro-queries.ts`, `db/research-queries.ts`, `db/profile-queries.ts`, `db/stats-queries.ts` (173 LOC) — none have direct tests.
- `ai/drafter.ts`, `ai/retro.ts`, `ai/auto-retro.ts`, `ai/combiner.ts`, `ai/coach-chat.ts`, `ai/coaching-analyzer.ts`, `ai/video-transcriber.ts`, `ai/profile-extractor.ts` — no direct tests.

**LOW**
- `db/backup.ts`, `db/client.ts`, `db/index.ts`, `db/dialect.ts` — mostly infrastructure.
- `ai/logger.ts`, `ai/taxonomy.ts`, `ai/shared-tools.ts`, `ai/platform-knowledge.ts`, `ai/interviewer-prompt.ts` — mostly data + pass-through helpers.

## Section 2 — Dashboard (dashboard/src/)

### What IS covered
- `pages/generate/lockedTopics.ts` (22 tests) — exhaustive.

### Testable units that need tests

**HIGH (pure logic, zero dependency, fast wins)**
- `pages/coach/components.tsx` — 8 exported pure functions with zero tests:
  - `getPriorityLabel(p)` — numeric/string → {label, classes}
  - `getConfidenceLabel(c)` — numeric/string → {label, dotClass}
  - `formatCategory(s)` — slug → Title Case
  - `formatTimeAgo(iso)` — relative time (has Z-suffix edge case)
  - `formatTimeUntil(iso)` — forward-looking formatter
  - `fmtNum(n)` — null-safe comma formatter
  - `deltaClass(curr, prev)` — trend → CSS class
  - `deltaLabel(curr, prev)` — trend → "+12%" string
- `api/helpers.ts`:
  - `withPersonaId(url)` — query-string append, ? vs & handling
- `context/PersonaContext.tsx`:
  - `getActivePersonaId()` — sessionStorage read + fallback

**MEDIUM**
- `hooks/useRealtimeInterview.ts` (210 LOC) — state machine for voice interviews.
- `pages/onboarding/*` state machines (several files 150-225 LOC).

**LOW / skip**
- React components with pure markup (most pages).

### Hot spots (>200 LOC, no tests)
| File | LOC |
|---|---|
| `pages/generate/DiscoveryView.tsx` | 737 |
| `pages/generate/components/ScannerLoader.tsx` | 629 |
| `pages/Settings.tsx` | 557 |
| `pages/Posts.tsx` | 427 |
| `api/types.ts` | 424 (types only) |
| `pages/generate/PostRetro.tsx` | 351 |
| `pages/coach/ActionsTab.tsx` | 326 |
| `api/generate.ts` | 322 |
| `pages/coach/components.tsx` | 284 |
| `pages/Overview.tsx` | 254 |
| `pages/Generate.tsx` | 251 |
| `pages/generate/GhostwriterChat.tsx` | 248 |
| `pages/coach/InsightsTab.tsx` | 247 |
| `pages/Coach.tsx` | 241 |
| `pages/settings/InterviewModal.tsx` | 236 |
| `pages/Followers.tsx` | 235 |
| `pages/coach/DeepDiveTab.tsx` | 238 |
| `hooks/useRealtimeInterview.ts` | 210 |

Most are React components mixing markup with state. Extracting pure reducers / derivation functions from the largest ones is the sensible path forward — not testing JSX directly.

## Section 3 — Extension (extension/src/)

### What IS covered
- `shared/utils.ts` (21 tests)
- `content/scrapers.ts` — `scrapePostDetail`, `scrapeTopPosts`, `scrapeAudience`, `scrapeProfileViews`, `scrapeSearchAppearances`, `scrapePostPage`, `scrapeProfilePhoto` (16 tests, synthetic DOM fixtures)

### Gaps

**HIGH**
- `content/company-scrapers.ts` — 3 exports (`scrapeCompanyAnalytics`, `hasMoreAnalyticsPages`, `scrapeCompanyPosts`), zero tests. These run against live LinkedIn company-admin DOM.
- `shared/utils.ts` — new `waitFor` helper (I just added) has no test.
- `background/service-worker.ts` (1282 LOC) — contains several pure/testable helpers buried in a chrome.*-heavy file:
  - `randomDelay(min, max)` — pacing calculation
  - Offline queue shape (`queueForRetry` / `drainOfflineQueue`) — sessionStorage/chrome.storage serialization
  - Batch sizing + throttling math inside `processBatch`

**MEDIUM**
- `popup/popup.ts` — health-check rendering, status formatting.
- `shared/types.ts` — Zod schema validation (tested indirectly through scrapers).

**Integration flows with zero automated coverage**
- First-run onboarding end-to-end
- Full sync cycle (discover → fetch hook text → click "see more" → fetch full text)
- Persona switching mid-sync
- Offline queue retry under flaky network

## Test Plan — what we'll add now

Priority ordering for this PR (highest ROI / lowest friction first):

### Phase A — Dashboard pure functions (vitest, no jsdom needed)
1. `pages/coach/components.test.tsx` — all 8 pure formatters
2. `api/helpers.test.ts` — `withPersonaId` including edge cases
3. `context/PersonaContext.test.ts` — `getActivePersonaId` with mocked sessionStorage

### Phase B — Extension gaps
4. `content/company-scrapers.test.ts` — fixtures for table rows, pagination, post list
5. `shared/utils.test.ts` — extend with `waitFor` cases
6. `content/index.test.ts` — routing/wait logic for post-summary with engagement-card predicate

### Phase C — Server high-risk gaps
7. `rule-queries.test.ts` — bulk replace manual/auto, reorder, enabled flag
8. `ingest-routes.test.ts` — idempotency on duplicate URN, partial payloads, persona scoping

Tests we are explicitly NOT writing in this PR:
- Full React component rendering tests for the large pages (would require significant refactoring to extract testable logic first)
- Cross-process integration tests (requires test infra)
- Service-worker chrome.* mocking (high friction, lower ROI than the plain-pure extraction)
