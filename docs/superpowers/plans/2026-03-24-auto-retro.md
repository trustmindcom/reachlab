# Auto-Retro Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect when a scraped LinkedIn post matches an existing draft, run retro analysis in the background, and surface writing prompt change suggestions in the Coach page.

**Architecture:** When `/api/ingest` receives a post with `full_text`, a new fire-and-forget step compares the first ~10 lines of that text against unmatched generations from the last 90 days using Haiku. On match, the system runs the full retro analysis (Sonnet) and stores results. Coach page gets a new "Post Retro" section showing pending prompt edits with Apply buttons.

**Tech Stack:** Fastify, better-sqlite3, Anthropic SDK (via OpenRouter), React + Tailwind

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/ai/auto-retro.ts` | Create | Match detection (Haiku) + orchestration |
| `server/src/ai/retro.ts` | Modify | Export existing `analyzeRetro` (no changes needed — already exported) |
| `server/src/app.ts` | Modify | Add fire-and-forget auto-retro trigger after ingest |
| `server/src/db/generate-queries.ts` | Modify | Add `getUnmatchedGenerations()` and `getRecentPostsWithText()` queries |
| `server/src/routes/generate.ts` | Modify | Add `GET /api/generate/retros/pending` endpoint for Coach |
| `dashboard/src/api/client.ts` | Modify | Add `getPendingRetros()` API call and types |
| `dashboard/src/pages/Coach.tsx` | Modify | Add "Post Retro" section showing pending prompt edits |

---

## Chunk 1: Server — Matching and Auto-Retro Pipeline

### Task 1: Add query helpers for matching candidates

**Files:**
- Modify: `server/src/db/generate-queries.ts`

- [ ] **Step 1: Add `getUnmatchedGenerations` query**

```typescript
export function getUnmatchedGenerations(
  db: Database.Database,
  daysBack: number = 90
): Array<{ id: number; final_draft: string; created_at: string }> {
  return db
    .prepare(
      `SELECT id, final_draft, created_at FROM generations
       WHERE final_draft IS NOT NULL
         AND matched_post_id IS NULL
         AND status IN ('draft', 'copied')
         AND created_at > datetime('now', '-' || ? || ' days')
       ORDER BY created_at DESC`
    )
    .all(daysBack) as any[];
}
```

- [ ] **Step 2: Add `getRecentPostsWithNewText` query**

Returns posts that have `full_text` and were updated recently (since last auto-retro check).

```typescript
export function getRecentPostsWithText(
  db: Database.Database,
  sinceIso?: string
): Array<{ id: string; full_text: string; published_at: string }> {
  const where = sinceIso
    ? "WHERE full_text IS NOT NULL AND updated_at > ?"
    : "WHERE full_text IS NOT NULL";
  const params = sinceIso ? [sinceIso] : [];
  return db
    .prepare(
      `SELECT id, full_text, published_at FROM posts ${where} ORDER BY published_at DESC LIMIT 50`
    )
    .all(...params) as any[];
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/db/generate-queries.ts
git commit -m "feat(auto-retro): add query helpers for matching candidates"
```

### Task 2: Create the auto-retro matching engine

**Files:**
- Create: `server/src/ai/auto-retro.ts`

- [ ] **Step 1: Create the match detection function**

This sends the first 10 lines of each post + each draft to Haiku to determine if they're the same piece of content. Only called once per new post with `full_text`.

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { analyzeRetro } from "./retro.js";
import { getUnmatchedGenerations, updateGeneration } from "../db/generate-queries.js";
import { getRules } from "../db/generate-queries.js";

function firstNLines(text: string, n: number): string {
  return text.split("\n").slice(0, n).join("\n");
}

interface MatchCandidate {
  generationId: number;
  fullDraft: string;
}

/**
 * Ask Haiku whether a published post matches any of the candidate drafts.
 * Returns the generation ID of the best match, or null.
 */
async function findMatch(
  client: Anthropic,
  postExcerpt: string,
  candidates: Array<{ id: number; excerpt: string }>
): Promise<number | null> {
  if (candidates.length === 0) return null;

  const candidateList = candidates
    .map((c, i) => `DRAFT ${i + 1} (id=${c.id}):\n${c.excerpt}`)
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 100,
    system: "You match published LinkedIn posts to their original AI-generated drafts. The published version may be heavily edited but will share the same core topic and key ideas. Return ONLY a JSON object.",
    messages: [{
      role: "user",
      content: `PUBLISHED POST (excerpt):\n${postExcerpt}\n\n---\n\nCANDIDATE DRAFTS:\n${candidateList}\n\nWhich draft, if any, is this post based on? The post may have been significantly rewritten but will share the same core topic/argument.\n\nReturn JSON only: { "match_id": <draft id or null>, "confidence": "high"|"medium"|"none" }\nReturn null if none are a clear match.`
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.match_id && parsed.confidence !== "none") {
      return parsed.match_id;
    }
  } catch {}
  return null;
}

/**
 * Main auto-retro pipeline. Called fire-and-forget from ingest.
 * For each new post with full_text, check if it matches an unmatched generation.
 * If so, run the retro analysis and store results.
 */
export async function runAutoRetro(
  client: Anthropic,
  db: Database.Database,
  postIds: string[]
): Promise<void> {
  const generations = getUnmatchedGenerations(db, 90);
  if (generations.length === 0) return;

  const rules = getRules(db).filter(r => r.enabled).map(r => r.rule_text);
  const writingPrompt = (
    db.prepare("SELECT value FROM settings WHERE key = 'writing_prompt'").get() as { value: string } | undefined
  )?.value;

  for (const postId of postIds) {
    const post = db
      .prepare("SELECT id, full_text, published_at FROM posts WHERE id = ? AND full_text IS NOT NULL")
      .get(postId) as { id: string; full_text: string; published_at: string } | undefined;
    if (!post) continue;

    // Check if this post is already matched to a generation
    const alreadyMatched = db
      .prepare("SELECT id FROM generations WHERE matched_post_id = ?")
      .get(post.id);
    if (alreadyMatched) continue;

    const postExcerpt = firstNLines(post.full_text, 10);
    const candidates = generations.map(g => ({
      id: g.id,
      excerpt: firstNLines(g.final_draft, 10),
    }));

    const matchId = await findMatch(client, postExcerpt, candidates);
    if (!matchId) continue;

    // Verify the match with the full texts
    const gen = generations.find(g => g.id === matchId);
    if (!gen) continue;

    // Store the match
    updateGeneration(db, matchId, { matched_post_id: post.id, status: "published" });
    db.prepare(
      "UPDATE generations SET published_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(post.full_text, matchId);

    // Run full retro analysis
    try {
      const { analysis } = await analyzeRetro(
        client, gen.final_draft, post.full_text, rules, writingPrompt
      );
      db.prepare(
        "UPDATE generations SET retro_json = ?, retro_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(JSON.stringify(analysis), matchId);
      console.log(`[Auto-Retro] Matched post ${post.id} → generation ${matchId}, retro complete`);
    } catch (err: any) {
      console.error(`[Auto-Retro] Retro analysis failed for generation ${matchId}:`, err.message);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/auto-retro.ts
git commit -m "feat(auto-retro): matching engine — Haiku match + Sonnet retro"
```

### Task 3: Wire auto-retro into the ingest pipeline

**Files:**
- Modify: `server/src/app.ts`

- [ ] **Step 1: Add fire-and-forget auto-retro trigger after post upsert**

After the existing AI pipeline trigger (around line 358), add:

```typescript
// Auto-retro: match new posts to drafts
if (aiApiKey && payload.posts) {
  // Only check posts that have full_text (content already scraped)
  const postsWithText = payload.posts.filter(p => p.full_text);
  if (postsWithText.length > 0) {
    Promise.all([
      import("./ai/auto-retro.js"),
      import("./ai/client.js"),
    ]).then(([{ runAutoRetro }, { createClient }]) => {
      const client = createClient(aiApiKey);
      runAutoRetro(client, db, postsWithText.map(p => p.id)).catch((err: any) => {
        console.error("[Auto-Retro] Failed:", err.message);
      });
    }).catch(() => {});
  }
}
```

This follows the existing fire-and-forget pattern used by image downloads, video transcription, and the AI pipeline.

- [ ] **Step 2: Commit**

```bash
git add server/src/app.ts
git commit -m "feat(auto-retro): wire into ingest pipeline as fire-and-forget"
```

### Task 4: Add pending retros API endpoint

**Files:**
- Modify: `server/src/routes/generate.ts`

- [ ] **Step 1: Add `GET /api/generate/retros/pending` endpoint**

Returns generations that have `retro_json` but whose prompt edits haven't been applied yet. Used by Coach to show the "Post Retro" section.

```typescript
app.get("/api/generate/retros/pending", async () => {
  const rows = db
    .prepare(
      `SELECT id, final_draft, published_text, retro_json, retro_at, matched_post_id
       FROM generations
       WHERE retro_json IS NOT NULL
         AND retro_at IS NOT NULL
       ORDER BY retro_at DESC
       LIMIT 10`
    )
    .all() as Array<{
      id: number;
      final_draft: string;
      published_text: string;
      retro_json: string;
      retro_at: string;
      matched_post_id: string | null;
    }>;

  return {
    retros: rows.map(r => ({
      generation_id: r.id,
      draft_excerpt: r.final_draft.split("\n").slice(0, 3).join("\n"),
      retro_at: r.retro_at,
      matched_post_id: r.matched_post_id,
      analysis: JSON.parse(r.retro_json),
    })),
  };
});
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/generate.ts
git commit -m "feat(auto-retro): add pending retros endpoint for Coach"
```

---

## Chunk 2: Dashboard — Coach Integration

### Task 5: Add API types and client call

**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add `PendingRetro` type and `getPendingRetros` call**

```typescript
export interface PendingRetro {
  generation_id: number;
  draft_excerpt: string;
  retro_at: string;
  matched_post_id: string | null;
  analysis: RetroAnalysis;
}

// In the api object:
getPendingRetros: () =>
  get<{ retros: PendingRetro[] }>("/generate/retros/pending"),
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat(auto-retro): add pending retros API client"
```

### Task 6: Add Post Retro section to Coach page

**Files:**
- Modify: `dashboard/src/pages/Coach.tsx`

- [ ] **Step 1: Add state and data fetching for pending retros**

Near the top of the Coach component, alongside existing state:

```typescript
const [pendingRetros, setPendingRetros] = useState<PendingRetro[]>([]);
const [appliedEdits, setAppliedEdits] = useState<Set<string>>(new Set());

// Fetch pending retros
useEffect(() => {
  api.getPendingRetros()
    .then(res => setPendingRetros(res.retros))
    .catch(() => {});
}, []);
```

- [ ] **Step 2: Add the apply handler**

```typescript
const handleApplyRetroEdit = async (
  retroId: number,
  editIndex: number,
  edit: RetroPromptEdit
) => {
  const key = `${retroId}-${editIndex}`;
  try {
    const res = await api.getWritingPrompt();
    const current = res.text ?? "";
    let updated: string;

    if (edit.type === "add") {
      if (current.includes(edit.add_text)) return;
      updated = current.trimEnd() + "\n\n" + edit.add_text;
    } else if (edit.type === "remove" && edit.remove_text) {
      if (!current.includes(edit.remove_text)) return;
      updated = current.replace(edit.remove_text, "").replace(/\n{3,}/g, "\n\n").trim();
    } else if (edit.type === "replace" && edit.remove_text) {
      if (!current.includes(edit.remove_text)) {
        updated = current.trimEnd() + "\n\n" + edit.add_text;
      } else {
        updated = current.replace(edit.remove_text, edit.add_text);
      }
    } else {
      return;
    }

    await api.saveWritingPrompt(updated, "ai_suggestion", edit.reason);
    setAppliedEdits(prev => new Set(prev).add(key));
  } catch {}
};
```

- [ ] **Step 3: Add the Post Retro section UI**

Add this as a new section in the Coach page, above or below the existing recommendations. Render only when `pendingRetros.length > 0`:

```tsx
{/* Post Retro — auto-detected prompt improvements */}
{pendingRetros.length > 0 && (
  <div className="mb-8">
    <h2 className="text-[13px] font-semibold text-text-primary uppercase tracking-wider mb-4">
      Post Retro
    </h2>
    <p className="text-[12px] text-text-muted mb-4">
      Based on changes you made between AI drafts and what you published
    </p>
    {pendingRetros.map(retro => (
      <div key={retro.generation_id} className="bg-surface-1 rounded-xl border border-border p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] text-text-muted">
            {formatTimeAgo(retro.retro_at)}
          </span>
          <span className="text-[11px] text-text-muted">
            Draft #{retro.generation_id}
          </span>
        </div>
        <p className="text-[13px] text-text-primary mb-4 leading-relaxed">
          {retro.analysis.summary}
        </p>

        {retro.analysis.prompt_edits && retro.analysis.prompt_edits.length > 0 && (
          <div className="space-y-3">
            <span className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
              Suggested prompt updates
            </span>
            {retro.analysis.prompt_edits.map((edit, i) => {
              const key = `${retro.generation_id}-${i}`;
              const applied = appliedEdits.has(key);
              return (
                <div key={i} className="bg-surface-2 rounded-lg p-4 border border-border">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-[12px] text-text-muted mb-2">{edit.reason}</p>
                      {edit.remove_text && (
                        <div className="text-[12px] bg-negative/5 text-negative/80 rounded px-2 py-1 mb-1 font-mono">
                          - {edit.remove_text}
                        </div>
                      )}
                      <div className="text-[12px] bg-positive/5 text-positive/80 rounded px-2 py-1 font-mono">
                        + {edit.add_text}
                      </div>
                    </div>
                    <button
                      onClick={() => handleApplyRetroEdit(retro.generation_id, i, edit)}
                      disabled={applied}
                      className={`shrink-0 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                        applied
                          ? "bg-positive/10 text-positive border border-positive/20"
                          : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                      }`}
                    >
                      {applied ? "Applied" : "Apply"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4: Add imports**

Add `PendingRetro` and `RetroPromptEdit` to the imports from `../api/client`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/Coach.tsx dashboard/src/api/client.ts
git commit -m "feat(auto-retro): Post Retro section in Coach with Apply buttons"
```

---

## Chunk 3: Generation Status Updates

### Task 7: Hide published generations from draft views

**Files:**
- Modify: `server/src/routes/generate.ts` (generation history endpoint)
- Modify: `dashboard/src/pages/generate/GenerationHistory.tsx` (if it shows drafts)

- [ ] **Step 1: Verify how generation history is filtered**

Check the existing `GET /api/generate/history` endpoint. It already accepts a `status` filter. Generations with status `published` should not appear in the default "draft" view.

- [ ] **Step 2: Update the generation history UI default filter**

If the history view defaults to showing all statuses, change it to default to `draft,copied` to exclude `published` and `discarded`. Published drafts should only be visible when the user explicitly filters for them.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/generate.ts dashboard/src/pages/generate/GenerationHistory.tsx
git commit -m "feat(auto-retro): hide published generations from draft list"
```

---

## Chunk 4: Combiner Length Enforcement + Tightening Loop

**Problem:** The combiner (`server/src/ai/combiner.ts`) doesn't receive or enforce the user's chosen `draftLength`. Individual drafts respect length targets (e.g., medium = 150-250 words), but when combining 2+ drafts, the LLM merges content without a word count constraint — producing a 449-word post when the user selected "medium". The quality gate doesn't check word count either.

**Approach:** Pass `draftLength` into the combiner. After combining, check word count. If it exceeds the target range, bounce it back to the LLM with the generation rules, coaching insights, and writing prompt as context — telling it to tighten the draft using those best practices to decide what to cut.

### Task 8: Pass draftLength into the combiner and add tightening loop

**Files:**
- Modify: `server/src/ai/combiner.ts`
- Modify: `server/src/routes/generate.ts` (the combine endpoint)

- [ ] **Step 1: Add length parameter and tightening loop to `combineDrafts`**

In `combiner.ts`:
- Add `length?: DraftLength` parameter
- After combining, count words
- If over target max by >20%, send a tightening prompt that includes generation rules and writing prompt
- The tightening prompt tells the LLM: "This is too long. Use these writing principles to decide what to cut. Sharpen, don't summarize."
- Max 1 tightening pass (don't loop forever)

```typescript
import { type DraftLength, LENGTH_INSTRUCTIONS } from "./drafter.js";

const LENGTH_RANGES: Record<DraftLength, { min: number; max: number }> = {
  short: { min: 80, max: 120 },
  medium: { min: 150, max: 250 },
  long: { min: 300, max: 450 },
};

// After initial combine, check word count:
const wordCount = result.split(/\s+/).length;
if (length && wordCount > LENGTH_RANGES[length].max * 1.2) {
  // Tighten: bounce back to LLM with writing principles
  const tightenPrompt = `This LinkedIn post is ${wordCount} words but needs to be ${LENGTH_RANGES[length].min}-${LENGTH_RANGES[length].max} words.

WRITING PRINCIPLES TO GUIDE CUTS:
${systemPrompt ?? ""}

Tighten this post. Cut what doesn't carry weight. Sharpen sentences. Don't summarize — keep the voice and the strongest material. Remove filler, merge redundant points, eliminate anything that restates what's already implied.

POST:
${result}

Return only the tightened post as plain text.`;

  // Call LLM again for tightening
  const tightenResponse = await client.messages.create({ ... });
}
```

- [ ] **Step 2: Export `LENGTH_INSTRUCTIONS` from drafter.ts**

Make `LENGTH_INSTRUCTIONS` exportable so combiner can reference the same targets.

- [ ] **Step 3: Pass `draftLength` from the combine route**

In `server/src/routes/generate.ts`, find the combine endpoint and pass `draft_length` through to `combineDrafts()`. Also pass the assembled system prompt (which includes rules and coaching insights) so the tightening loop has full context.

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/combiner.ts server/src/ai/drafter.ts server/src/routes/generate.ts
git commit -m "fix: enforce length target in combiner with LLM tightening loop"
```

---

## Chunk 5: Recommendation Deduplication

**Problem:** The AI insights pipeline generates duplicate recommendations over time. Examples from the current DB:
- Recommendations #3 and #9 both say "drive 30+ comments"
- #6 and #11 both say "stop leading with news headlines"
- #4, #16, #21, #26 all about Thursday/afternoon posting
- #2, #12, #27 all about leading with personal experience
- #17 and #13 both about posting 2-3x/week

### Task 10: Add deduplication to the recommendation pipeline

**Files:**
- Modify: `server/src/ai/orchestrator.ts` (where recommendations are generated/stored)

- [ ] **Step 1: Investigate existing dedup logic**

Check if `stable_key` on the `recommendations` table is meant for deduplication. Read the orchestrator to understand how recommendations are generated and stored. The `stable_key` column + `resolved_type`/`resolved_at` columns suggest there was intent to deduplicate but it may not be working.

- [ ] **Step 2: Add Haiku-based dedup check before inserting recommendations**

Before inserting a new recommendation, send it along with existing unresolved recommendations to Haiku. Ask: "Is this new recommendation substantially the same as any existing one? If so, which one?" If it matches, skip or merge.

Alternative: Use simple text overlap — if a new recommendation's `headline` shares >60% of words with an existing one, skip it.

- [ ] **Step 3: Clean up existing duplicates**

Write a one-time cleanup query or script that resolves duplicate recommendations, keeping the most recent version of each.

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/orchestrator.ts
git commit -m "fix: deduplicate recommendations to prevent repeated advice"
```

---

## Notes

### Matching Strategy
- Uses Haiku for matching (cheap, ~0.1 cents per check, accurate for semantic matching)
- Sends first 10 lines of each text to keep tokens low
- Only checks unmatched generations from last 90 days
- Runs once per new post at ingest time — not a recurring job
- Matched generations get `status: 'published'` and `matched_post_id` set

### Cost Estimate
- **Matching**: ~200 input tokens per candidate × N candidates per post, Haiku pricing → negligible
- **Retro analysis**: ~2K input tokens, Sonnet pricing → ~1-2 cents per retro (only runs on confirmed matches)
- Expected volume: 2-3 posts/week → ~$0.10/month

### Edge Cases
- Post heavily rewritten → Haiku may not match. That's fine — user can still do manual retro.
- Multiple drafts match → Haiku picks the best one. Confidence threshold prevents weak matches.
- Same post ingested twice → `alreadyMatched` check prevents duplicate retros.
- Generation has no `final_draft` → filtered out by query.
