# Intent-Led Generation Design

**Status:** Approved for the three-PR direct cutover
**Scope:** Bounded behavior change and directly encountered debt cleanup
**Supersedes:** `writing-project-consolidation-design.md` and its 32-lane rewrite train

## Problem Statement

The Generate flow treats a selected story or a model-generated brainstorm angle as the authority for a post. When the user types what they want to write about without selecting a story, the system first invents angles and later drafts from the chosen angle. This can replace the user's intended claim. The review flow also requires at least one existing draft before accepting feedback, so the user cannot reject every draft and restart from the original intent.

The desired behavior is:

1. The user's text, canonicalized once by trimming outer whitespace, is the controlling author intent. Internal whitespace, punctuation, and casing are preserved.
2. If no ambient story was selected, search for relevant stories from the prior two calendar months.
3. If the recent search succeeds but has zero relevant results, repeat once without a date restriction.
4. Related stories are optional evidence. They never replace the author intent and no selection is required.
5. If research returns no relevant evidence, generation still proceeds from intent.
6. If research fails, show the error and allow explicit generation from intent.
7. With zero included drafts, feedback means restart from intent rather than forcing a draft selection.

## Root Cause

There is no persisted author-intent field. The same conceptual choice is represented by separate fields and branches:

- `generation_research.topic`
- `generations.selected_story_index`
- `generations.brainstorm_topic`
- `generations.brainstorm_angle`
- frontend `selectedTopic`, `selectedStoryIndex`, `brainstormTopic`, and `selectedAngle`

`generations` is created only after drafting, so research and failed attempts have no durable workflow identity. Drafting then branches between a selected `Story` and `{ topic, angle }`. Ghostwriter history reconstructs context from whichever branch happened to be used.

## Current System Model

`generations` is already the de facto workflow aggregate. It owns or points to:

- research,
- story selection,
- draft JSON and revision selection,
- final/editor draft,
- lifecycle status,
- publication match and retro,
- prompt snapshot and cost fields,
- active restore and history identity.

The bounded change promotes this existing row to the early workflow owner. It does not introduce a parallel project aggregate.

## Canonical Owner Decision

Add nullable `author_intent` to `generations` and create the row before any research or model call.

- For all new flows, `generations.author_intent` is required by the service, canonicalized once at start, and immutable.
- The database column remains nullable so historical rows require no backfill or table rebuild.
- Historical rows use one isolated read-only context fallback based on their existing story/brainstorm data.
- No new write path may populate `brainstorm_topic` or `brainstorm_angle`.
- `generation_research` remains evidence storage.
- Existing draft, editor, history, publication, retro, and coaching state remains on `generations` and its current related tables.

This improves the existing aggregate's invariant without redesigning unrelated artifacts.

## Business Invariants

1. Every new writing flow persists canonical author intent before any research or model call.
2. Author intent is immutable for a generation. A changed thesis starts a new generation.
3. Research, story selection, prompts, and model output cannot rewrite or replace author intent.
4. New research, draft, revision, and ghostwriter operations load intent from the server-owned generation row; request bodies cannot submit a replacement topic or angle.
5. A selected story is optional anchor evidence. With no selection, all returned stories are optional supporting evidence. With no evidence, intent-only drafting remains valid.
6. All-time research runs only after the recent provider call and relevance pass both succeed with zero relevant results.
7. Provider, configuration, validation, or timeout failure remains a visible error and is never persisted as no evidence.
8. Restart-from-intent receives intent, optional evidence, and user feedback but no rejected draft text.
9. Historical null-intent rows remain readable in history, but new research, draft, revision, and ghostwriter commands reject them. There is no compatibility context builder.
10. Existing generation IDs and downstream editor, history, publication, retro, coaching, and combine behavior remain authoritative and are not reimplemented.

## Data Model

One additive migration:

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

There is no historical update. Existing rows remain null-compatible. New service calls refuse to run research, drafting, or restart without a nonblank stored intent.

`search_scope` makes recent success, all-time fallback, and anchored research distinguishable without introducing a new evidence table. An empty `stories_json` with `search_scope = 'all_time'` is the durable successful no-evidence result. Provider failure creates no research row and remains visible on its failed AI run.

## API Contract

### Start

```text
POST /api/generate/start
{ "author_intent": string }
-> { "generation_id": number, "author_intent": string }
```

The route trims outer whitespace, rejects an empty result, preserves all internal text, and stores that canonical value. It inserts the generation before creating an AI client or run.

### Research

```text
POST /api/generate/research
{
  "generation_id": number,
  "avoid"?: string[],
  "source_context"?: {
    "summary": string,
    "source_headline": string,
    "source_url": string
  }
}
```

The server loads the stored intent. The caller cannot submit a replacement topic. The existing route changes in place; no parallel generation-scoped research route is added.

For typed intent without `source_context`, the research service runs recent search, relevance filtering, and conditional all-time fallback. For ambient inspiration with `source_context`, the existing anchored research behavior remains, but its output is evidence beneath the stored intent.

### Draft

```text
POST /api/generate/drafts
{ "generation_id": number, "story_index"?: number, "personal_connection"?: string, "length"?: "short" | "medium" | "long" }
```

The server loads the generation and its linked research:

- no research: intent-only drafting,
- research and no `story_index`: every returned story is supporting evidence,
- research and `story_index`: that story is the anchor evidence and remaining stories are supporting evidence.

The same generation row is updated with drafts and prompt snapshot. A second generation row is not inserted.

### Revise Or Restart

```text
POST /api/generate/revise-drafts
{
  "generation_id": number,
  "feedback": string,
  "mode": "revise_selected" | "restart_from_intent"
}
```

- `revise_selected` requires one or more valid selected draft indices and includes intent, selected drafts, and feedback.
- `restart_from_intent` requires zero selected drafts and includes intent, evidence, and feedback. It must not include rejected draft text.

## Writing Context

Add one focused `writing-context.ts` boundary:

```ts
interface WritingContext {
  generationId: number;
  authorIntent: string;
  anchorEvidence: Story | null;
  supportingEvidence: Story[];
}
```

Its rendered order is fixed:

1. `AUTHOR INTENT - CONTROLLING`
2. optional `ANCHOR EVIDENCE - FACTUAL CONTEXT ONLY`
3. optional `SUPPORTING EVIDENCE - MAY INFORM, MUST NOT REPLACE INTENT`

Initial drafting, revise-selected, restart-from-intent, and ghostwriter use this boundary. The loader rejects a generation without `author_intent`; old history rows remain displayable without inventing a second context reconstruction path.

## Research Semantics

The entered-intent path uses a new direct Search API adapter rather than changing the existing OpenRouter synthesis wrapper.

- Endpoint: `POST https://api.perplexity.ai/search`
- Key: `PERPLEXITY_API_KEY`
- Recent filter: `search_after_date_filter` in `MM/DD/YYYY`
- Cutoff: exactly two calendar months before the request date
- Results: structured `title`, `url`, `snippet`, `date`, and `last_updated`

The current provider contract is documented by the [Perplexity Search API](https://docs.perplexity.ai/api-reference/search-post) and its [date filter documentation](https://docs.perplexity.ai/docs/search/filters/date-time-filters).

Research algorithm:

1. Search with the recent cutoff.
2. Validate URLs and dates; retain only recent dated results.
3. Ask the relevance classifier to return only IDs from those results.
4. If at least one relevant result remains, synthesize up to three story cards and persist `search_scope = recent`.
5. If zero relevant results remain, perform one all-time search and relevance pass.
6. Persist all-time results or an empty array with `search_scope = all_time`.
7. A provider/configuration/timeout error returns an error and does not trigger all-time fallback or persist false no-evidence.
8. Synthesis runs only when relevance selected at least one page. Its output is strictly schema-validated and must contain one to three stories. Malformed, invalid, or empty synthesis is a visible failure, creates no research row, and never triggers fallback.

## Product Flow

### Typed Intent

1. The user types intent and submits.
2. The client clears ambient expansion, selected story, and prior research state.
3. `/start` persists exact intent and returns `generation_id`.
4. `/research` searches recent then conditionally all-time.
5. The UI presents returned stories as optional context, not a required choice.
6. Generate is enabled with one selected story, no selected story, zero results, or after an explicit skip following research failure.
7. A same-session research retry may reuse source context still held by the client. After application reload, an early generation with no research row restores only its intent; the UI offers Generate from my intent or Start over, not a misleading Retry whose evidence semantics would differ.
8. Intent-only generations use author intent as their active/history label instead of requiring a selected story or brainstorm angle.

### Ambient Inspiration

1. The user chooses an ambient item and may enter guidance.
2. The canonicalized guidance becomes author intent; when guidance is empty, the visible item label is used as an editable fallback before submission.
3. `/start` persists that intent.
4. `/research` receives the existing source context.
5. The selected source and any supplemental stories remain evidence beneath intent.

### Draft Review

1. Selecting drafts plus feedback revises those drafts.
2. Selecting no drafts plus feedback shows and executes `Start over from my intent`.
3. Restart excludes all rejected draft text.
4. Existing combine/finalize behavior still requires selected drafts and is unchanged.

## Frontend State

Keep the existing four-step controller and local React state. Change only the affected fields:

```ts
type GenerationState = {
  generationId: number | null;
  authorIntent: string;
  researchId: number | null;
  stories: GenStory[];
  selectedStoryIndex: number | null;
  // existing draft/editor/retro fields remain
};
```

Remove `brainstormAngles`, `brainstormTopic`, and `selectedAngle` after cutover. Do not introduce global state or rewrite the rest of `Generate.tsx`.

`DiscoveryView` remains the existing component for this slice. Extract small pure helpers where tests need them, but do not split the whole component merely because it is large.

## Observability

- `createRun` accepts optional `generationId`; all touched research/draft/revise/ghostwriter calls supply it.
- AI run listings include `generation_id` so a bad output can be traced to its calls.
- Touched AI operations log the exact rendered user message/context sent to the provider, not placeholder summaries such as `Brainstorm angles: ...`.
- The existing raw log model, cost accounting, and retention remain unchanged.

The generation-to-run link is retained because existing run IDs have no durable association with a generated output, which was the original diagnostic gap. This plan does not otherwise modify the generic Insights run/log API or its authorization behavior.

## Failure Modes

- **Start fails:** no AI call begins and the user remains on the composer.
- **Recent provider fails:** show research failure; do not call all-time or claim no evidence.
- **Relevant pages exist but synthesis is malformed, invalid, or empty:** fail the run, create no research row, and do not call all-time fallback.
- **Recent succeeds with zero relevant results:** call all-time exactly once.
- **All-time returns zero:** persist successful no-evidence and allow drafting.
- **Research fails after start:** keep generation and exact intent; explicit generate-without-research remains available.
- **Cross-persona generation ID:** return not-found/forbidden according to existing route convention and commit nothing.
- **Invalid story index:** return `400`; do not fall back silently to all evidence.
- **Restart with selected drafts:** return `400`; mode and selection must agree.
- **Legacy row has null intent:** history remains readable; new research/draft/restart/ghostwriter commands reject it.
- **Reload after failed anchored research:** restore canonical intent but do not label entered-intent search as an anchored Retry. Offer intent-only generation or start-over.

## Migration And Rollback

The migration is additive and has no backfill or destructive statement. Before implementation, reserve the next migration number from the merged baseline.

Rollback means reverting application code. Nullable columns may remain safely. Existing brainstorm columns remain on historical rows and are not dropped because rebuilding the SQLite table would add risk without improving the new flow.

There is no parallel endpoint family and no dual-write period. PR 1 adds dormant storage, pure boundaries, and the Perplexity key to the existing settings surface. PR 2 changes the existing research and draft contracts together with the dashboard cutover, routes selected-draft revision and ghostwriter through stored intent, then deletes the brainstorm route, client method, model call, and active state in the same PR. PR 3 adds restart mode and narrowly scoped diagnostics.

## Explicitly Untouched

- `generation_revisions` and `generation_messages`
- mutable `drafts_json` and `final_draft`
- editor autosave/version semantics
- combine/chat and ghostwriter tool execution
- publication, retro, auto-retro, and ingest
- coaching, rules, sources, RSS discovery, and author profile
- analytics scheduling and AI-log retention
- extension code and route registration topology
- command ledgers, immutable artifact tables, and destructive legacy cleanup

These may deserve future work, but none blocks the intent authority invariant.

## Alternatives Rejected

### Full Writing-Project Rewrite

Rejected as disproportionate. It would replace draft, document, publication, retro, telemetry, and cleanup systems that are not required for this behavior.

### Separate `writing_projects` Table

Rejected for this slice because `generations` already owns the workflow identity and every downstream consumer. A second identity would add joins, linkage, and lifecycle ambiguity without removing the existing aggregate.

### Patch Topic Parameters Only

Rejected because intent would still be caller-controlled, not persisted before AI work, and downstream revision/ghostwriter paths could reconstruct a different authority.

## Tests

- Canonical intent is stored before client/provider creation.
- Research request cannot replace stored intent.
- Recent relevant evidence prevents fallback.
- Recent zero triggers exactly one all-time search.
- Provider error never triggers fallback or false no-evidence.
- Zero evidence permits draft generation.
- No story selection uses all research stories as supporting evidence.
- Selected story is labeled anchor while intent remains first.
- Every initial draft prompt includes the canonical author intent unchanged.
- Restart contains intent/evidence/feedback and no rejected draft text.
- Revise-selected contains intent plus only selected drafts.
- Ghostwriter context for new rows uses author intent.
- Legacy null-intent rows remain viewable but reject new writing commands.
- Cross-persona generation access is rejected.
- Dashboard state clears ambient selection when typed intent is submitted.
- Generate is enabled without a story selection.
- Zero selected drafts exposes restart-from-intent.

## Ownership

Three stacked PRs implement this design:

1. PR 1 adds the early generation owner, direct search orchestration, the existing Perplexity configuration entry, and the single writing-context boundary without changing the active dashboard flow.
2. PR 2 performs one atomic backend-and-dashboard cutover for research and initial drafting, moves every already-active writing path to stored intent, and deletes the brainstorm write path in the same PR.
3. PR 3 adds restart-from-intent, exact-input diagnostics, narrowly scoped run correlation, and release validation.

`server/src/routes/generate.ts` is sequentially owned across the three PRs. No PR introduces a second project identity, route family, state framework, or generalized telemetry subsystem.
