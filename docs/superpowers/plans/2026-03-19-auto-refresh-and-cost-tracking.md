# Auto-Refresh AI Pipeline & Cost Tracking Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically run cheap AI steps (tagging, taxonomy, images) on every sync and full interpretation weekly or after N new posts (whichever first), with real cost tracking and a redesigned settings page.

**Architecture:** Split the existing monolithic `runPipeline` into two tiers: a cheap "tag-only" pipeline that runs on every sync, and the full interpretation pipeline that runs on a configurable schedule. Add cost calculation using per-model pricing. Redesign the settings page to organize growing settings into logical sections with a clean card-based layout.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React, Tailwind CSS

---

## File Structure

- **Modify:** `server/src/ai/orchestrator.ts` — split pipeline into `runTaggingPipeline()` and `runFullPipeline()`, add cost calculation
- **Modify:** `server/src/ai/client.ts` — add pricing constants and `calculateCost()` helper
- **Modify:** `server/src/app.ts` — update ingest auto-trigger to use two-tier logic
- **Modify:** `server/src/routes/settings.ts` — add auto-refresh settings endpoints
- **Modify:** `server/src/routes/insights.ts` — add cost/run history endpoint
- **Modify:** `server/src/db/ai-queries.ts` — add `getRunLogs` query for cost calculation
- **Modify:** `dashboard/src/api/client.ts` — add API methods for new settings + run history
- **Modify:** `dashboard/src/pages/Settings.tsx` — redesign with sections, add AI refresh config

---

## Chunk 1: Cost Tracking & Pipeline Split

### Task 1: Add cost calculation to client.ts

**Files:**
- Modify: `server/src/ai/client.ts`

- [ ] **Step 1: Add pricing constants and calculateCost function**

```typescript
// Add after MODELS constant (line 8)

// OpenRouter pricing per 1M tokens (as of March 2026)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  [MODELS.HAIKU]: { input: 1, output: 5 },
  [MODELS.SONNET]: { input: 3, output: 15 },
  [MODELS.OPUS]: { input: 15, output: 75 },
  [MODELS.GPT54]: { input: 2.5, output: 10 },
};

const OPENROUTER_FEE = 0.055; // 5.5%

/** Calculate cost in cents from ai_logs rows for a run */
export function calculateCostCents(
  logs: Array<{ model: string; input_tokens: number; output_tokens: number }>
): number {
  let totalDollars = 0;
  for (const log of logs) {
    const pricing = MODEL_PRICING[log.model];
    if (!pricing) continue;
    totalDollars +=
      (log.input_tokens * pricing.input + log.output_tokens * pricing.output) / 1_000_000;
  }
  return Math.round(totalDollars * (1 + OPENROUTER_FEE) * 100);
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in client.ts

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/client.ts
git commit -m "feat: add model pricing constants and cost calculation helper"
```

### Task 2: Split pipeline into tagging-only and full interpretation

**Files:**
- Modify: `server/src/ai/orchestrator.ts`
- Modify: `server/src/db/ai-queries.ts`

- [ ] **Step 1: Add a query to get ai_logs for cost calculation**

In `server/src/db/ai-queries.ts`, add after the `getLatestCompletedRun` function (around line 150):

```typescript
export function getRunLogs(
  db: Database.Database,
  runId: number
): Array<{ model: string; input_tokens: number; output_tokens: number }> {
  return db
    .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
    .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
}

```

- [ ] **Step 2: Refactor orchestrator.ts — extract tagging pipeline**

Replace the entire `runPipeline` function in `server/src/ai/orchestrator.ts` with two functions. The key changes:
1. `runTaggingPipeline()` — runs taxonomy, tagging, image classification, top performer (cheap Haiku steps only)
2. `runFullPipeline()` — runs tagging pipeline first, then interpretation + storage (existing steps 3-8)
3. Both use `calculateCostCents()` for real cost tracking

```typescript
// Add import at top of file
import { calculateCostCents } from "./client.js";
// Add to existing ai-queries imports:
// getRunLogs

/**
 * Cheap pipeline: taxonomy, tagging, image classification, top performer.
 * Runs on every sync. ~$0.04 per run.
 */
export async function runTaggingPipeline(
  client: Anthropic,
  db: Database.Database,
  triggeredBy: string
): Promise<PipelineResult> {
  const running = getRunningRun(db);
  if (running) {
    return { runId: running.id, status: "failed", error: "A pipeline run is already in progress" };
  }

  const postCount = getPostCountWithMetrics(db);
  const runId = createRun(db, triggeredBy, postCount);
  const logger = new AiLogger(db, runId);

  try {
    // Step 1: Taxonomy and tagging
    const existingTaxonomy = getTaxonomy(db);
    await discoverTaxonomy(client, db, logger, existingTaxonomy.length > 0 ? existingTaxonomy : undefined);
    const untaggedIds = getUntaggedPostIds(db);
    if (untaggedIds.length > 0) {
      const posts = db
        .prepare(
          `SELECT id, COALESCE(full_text, content_preview) as content_preview
           FROM posts WHERE id IN (${untaggedIds.map(() => "?").join(",")})`
        )
        .all(...untaggedIds) as { id: string; content_preview: string | null }[];
      await tagPosts(client, db, posts, logger);
    }

    // Step 2: Image classification
    const dataDir = path.dirname(db.name);
    await classifyImages(client, db, dataDir, logger);

    // Sum tokens and calculate cost
    const tokenSums = db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens), 0) as input_tokens,
                COALESCE(SUM(output_tokens), 0) as output_tokens
         FROM ai_logs WHERE run_id = ?`
      )
      .get(runId) as { input_tokens: number; output_tokens: number };

    const logs = getRunLogs(db, runId);
    completeRun(db, runId, {
      input_tokens: tokenSums.input_tokens,
      output_tokens: tokenSums.output_tokens,
      cost_cents: calculateCostCents(logs),
    });

    return { runId, status: "completed" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    failRun(db, runId, message);
    return { runId, status: "failed", error: message };
  }
}

/**
 * Full pipeline: tagging + interpretation + storage.
 * Runs weekly or after N new posts. ~$0.48 per run.
 */
export async function runFullPipeline(
  client: Anthropic,
  db: Database.Database,
  triggeredBy: string
): Promise<PipelineResult> {
  // ... (keep existing runPipeline body but rename to runFullPipeline)
  // Update the cost_cents line (line 348) to:
  // cost_cents: calculateCostCents(getRunLogs(db, runId)),
}

// Keep runPipeline as an alias for backwards compatibility with manual refresh
export const runPipeline = runFullPipeline;
```

The `runFullPipeline` body is the existing `runPipeline` body with two changes:
1. Replace `cost_cents: 0` (line 348) with `cost_cents: calculateCostCents(getRunLogs(db, runId))`
2. Add `"auto"` to the `triggeredBy` bypass list at line 77: `if (triggeredBy !== "retag" && triggeredBy !== "force" && triggeredBy !== "auto")` — this is critical because the ingest handler (Task 3) already performs its own threshold checks before calling `runFullPipeline`, and without this bypass, `shouldRunPipeline` would see the just-completed tagging run as the latest run and incorrectly conclude there are no new posts.

Also add `getRunLogs` to the import statement from `../db/ai-queries.js` at the top of the file (line 14-32).

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/orchestrator.ts server/src/db/ai-queries.ts
git commit -m "feat: split pipeline into tagging-only and full, add real cost tracking"
```

### Task 3: Update ingest auto-trigger to use two-tier pipeline

**Files:**
- Modify: `server/src/app.ts`

- [ ] **Step 1: Replace the auto-trigger block in /api/ingest**

Replace lines 220-239 in `server/src/app.ts` (the "Auto-trigger AI pipeline" block) with:

```typescript
    // Auto-trigger AI pipeline (two-tier)
    const aiApiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (aiApiKey && postsUpserted > 0) {
      Promise.all([
        import("./ai/orchestrator.js"),
        import("./db/ai-queries.js"),
        import("./ai/client.js"),
      ]).then(([{ runTaggingPipeline, runFullPipeline }, { getPostCountWithMetrics, getLatestCompletedRun, getRunningRun, getSetting }, { createClient }]) => {
        if (getRunningRun(db)) return;
        const postCount = getPostCountWithMetrics(db);
        if (postCount < 10) return;

        const client = createClient(aiApiKey);

        // Always run cheap tagging pipeline on sync
        runTaggingPipeline(client, db, "sync_tagging").then(() => {
          // After tagging, check if full interpretation should run
          const schedule = getSetting(db, "auto_interpret_schedule") ?? "weekly";
          if (schedule === "off") return;

          const lastRun = getLatestCompletedRun(db);
          // Only consider full pipeline runs (not tagging-only)
          const lastFullRun = db.prepare(
            "SELECT id, post_count, completed_at FROM ai_runs WHERE status = 'completed' AND triggered_by NOT LIKE '%tagging%' ORDER BY id DESC LIMIT 1"
          ).get() as { id: number; post_count: number; completed_at: string } | undefined;

          const newPosts = lastFullRun ? postCount - lastFullRun.post_count : postCount;
          if (newPosts < 1) return; // No new posts, skip

          // Check post threshold
          const postThreshold = parseInt(getSetting(db, "auto_interpret_post_threshold") ?? "5", 10);
          const postThresholdMet = newPosts >= postThreshold;

          // Check time threshold
          let timeThresholdMet = !lastFullRun; // Always run if never run before
          if (lastFullRun && schedule !== "off") {
            const lastRunTime = new Date(lastFullRun.completed_at + "Z").getTime();
            const now = Date.now();
            const msPerDay = 86400000;
            const interval = schedule === "daily" ? msPerDay : 7 * msPerDay;
            timeThresholdMet = (now - lastRunTime) >= interval;
          }

          if (postThresholdMet || timeThresholdMet) {
            runFullPipeline(client, db, "auto").catch((err: any) => {
              console.error("[AI Pipeline] Auto-trigger failed:", err.message);
            });
          }
        }).catch((err: any) => {
          console.error("[AI Pipeline] Auto-trigger failed:", err.message);
        });
      }).catch(() => {});
    }
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/app.ts
git commit -m "feat: two-tier auto-trigger — tagging on every sync, interpretation on schedule"
```

---

## Chunk 2: Settings API & Run History

### Task 4: Add auto-refresh settings endpoints and run history

**Files:**
- Modify: `server/src/routes/settings.ts`
- Modify: `server/src/routes/insights.ts`

- [ ] **Step 1: Add auto-refresh settings endpoints to settings.ts**

Add before the closing `}` of `registerSettingsRoutes`:

```typescript
  // ── Auto-refresh settings ────────────────────────────────

  app.get("/api/settings/auto-refresh", async () => {
    const schedule = getSetting(db, "auto_interpret_schedule") ?? "weekly";
    const postThreshold = getSetting(db, "auto_interpret_post_threshold") ?? "5";
    return { schedule, post_threshold: parseInt(postThreshold, 10) };
  });

  app.put("/api/settings/auto-refresh", async (request, reply) => {
    const body = request.body as {
      schedule?: string;
      post_threshold?: number;
    };

    if (body.schedule !== undefined) {
      if (!["daily", "weekly", "off"].includes(body.schedule)) {
        return reply.status(400).send({ error: "schedule must be daily, weekly, or off" });
      }
      upsertSetting(db, "auto_interpret_schedule", body.schedule);
    }

    if (body.post_threshold !== undefined) {
      const n = Math.max(1, Math.min(50, Math.round(body.post_threshold)));
      upsertSetting(db, "auto_interpret_post_threshold", String(n));
    }

    return { ok: true };
  });
```

- [ ] **Step 2: Add run history endpoint to insights.ts**

Add a new endpoint in `server/src/routes/insights.ts` for viewing recent run costs:

```typescript
  // ── Run history with costs ────────────────────────────────

  app.get("/api/insights/runs", async () => {
    const runs = db
      .prepare(
        `SELECT id, triggered_by, post_count, status, started_at, completed_at,
                total_input_tokens, total_output_tokens, total_cost_cents
         FROM ai_runs
         WHERE status = 'completed'
         ORDER BY id DESC LIMIT 20`
      )
      .all();
    const totalCostCents = db
      .prepare(
        "SELECT COALESCE(SUM(total_cost_cents), 0) as total FROM ai_runs WHERE status = 'completed'"
      )
      .get() as { total: number };
    return { runs, total_cost_cents: totalCostCents.total };
  });
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/settings.ts server/src/routes/insights.ts
git commit -m "feat: add auto-refresh settings and run history endpoints"
```

### Task 5: Add API client methods in dashboard

**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add types and methods**

Add interface near the other interfaces:

```typescript
export interface AiRun {
  id: number;
  triggered_by: string;
  post_count: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cost_cents: number | null;
}
```

Add methods to the api object (before the closing `}`):

```typescript
  // Auto-refresh settings
  getAutoRefreshSettings: () =>
    get<{ schedule: string; post_threshold: number }>("/settings/auto-refresh"),

  saveAutoRefreshSettings: (settings: { schedule?: string; post_threshold?: number }) =>
    fetch(`${BASE_URL}/settings/auto-refresh`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  // Run history
  getAiRuns: () =>
    get<{ runs: AiRun[]; total_cost_cents: number }>("/insights/runs"),
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add auto-refresh settings and run history API client methods"
```

---

## Chunk 3: Settings Page Redesign

### Task 6: Redesign Settings.tsx with sections and auto-refresh config

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx`

- [ ] **Step 1: Rewrite Settings.tsx with sectioned layout and AI refresh settings**

Use the @frontend-design skill for this step. The settings page should be reorganized into clear sections:

1. **Profile** section — author photo (existing)
2. **Writing** section — writing prompt + history (existing)
3. **AI Analysis** section (new) — auto-refresh schedule, post threshold, run history with costs

Design requirements:
- Clean card-based layout with section headers
- The AI Analysis section should have:
  - A radio/segmented control for schedule: Daily / Weekly / Off (default: Weekly)
  - A number input for post threshold with label "Or after N new posts" (default: 5)
  - A compact run history table showing recent runs: date, trigger, tokens, cost
  - A total cost display (all time)
- Use existing Tailwind color tokens (bg-surface-1/2/3, text-text-primary/secondary/muted, border-border, accent)
- Match the existing card style (bg-surface-1 border border-border rounded-lg p-5)
- Settings should save immediately on change (no save button needed for radio/number — use onChange with debounce for the number input)

The full component should:
- Load auto-refresh settings and run history on mount
- Persist changes immediately via API
- Show a subtle "Saved" confirmation on change
- Display costs formatted as dollars (e.g., "$0.48") from the cents values

- [ ] **Step 2: Verify the page renders**

Run: `cd /Users/nate/code/linkedin && npm run build --workspace=dashboard 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "feat: redesign settings page with AI analysis config and cost tracking"
```

### Task 7: Backfill costs for existing runs

**Files:**
- Modify: `server/src/ai/orchestrator.ts` (or create a one-time migration)

- [ ] **Step 1: Add a backfill in the server startup or as a route**

Add a static import at the top of `server/src/routes/insights.ts`:

```typescript
import { calculateCostCents } from "../ai/client.js";
```

Then add the backfill inside `registerInsightsRoutes`, at the top of the function body (it runs synchronously at registration/startup time):

```typescript
  // Backfill costs for existing runs (runs once, idempotent)
  const runsToBackfill = db
    .prepare(
      "SELECT id FROM ai_runs WHERE status = 'completed' AND (total_cost_cents = 0 OR total_cost_cents IS NULL)"
    )
    .all() as { id: number }[];

  if (runsToBackfill.length > 0) {
    for (const run of runsToBackfill) {
      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(run.id) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      if (logs.length === 0) continue; // No logs = genuinely free run, skip
      const cost = calculateCostCents(logs);
      if (cost > 0) {
        db.prepare("UPDATE ai_runs SET total_cost_cents = ? WHERE id = ?").run(cost, run.id);
      }
    }
    console.log(`[Cost Backfill] Checked ${runsToBackfill.length} runs for missing costs`);
  }
```

Note: Uses a static import (not `await import()`) since `registerInsightsRoutes` is a synchronous function. Skips runs with no ai_logs (genuinely free runs) to avoid infinite re-backfilling.

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/insights.ts
git commit -m "feat: backfill cost_cents for existing AI runs on startup"
```

---

## Chunk 4: Sync Health Monitoring

Detect when LinkedIn changes their page structure so syncs don't silently degrade.

### Task 8: Fix LinkedIn URL change — use `/creator/top-posts`

**Files:**
- Modify: `extension/src/background/service-worker.ts`

- [ ] **Step 1: Update scrape URL**

In `extension/src/background/service-worker.ts`, change the navigation URLs (around line 196-198) from `analytics/creator/content` to `analytics/creator/top-posts`:

```typescript
      url: isBackfill
        ? "https://www.linkedin.com/analytics/creator/top-posts?timeRange=past_365_days&metricType=IMPRESSIONS"
        : "https://www.linkedin.com/analytics/creator/top-posts?metricType=IMPRESSIONS&timeRange=past_28_days",
```

Note: The content script at `extension/src/content/index.ts:89` already handles both `top-posts` and `content` URLs, so no change needed there.

- [ ] **Step 2: Commit**

```bash
git add extension/src/background/service-worker.ts
git commit -m "fix: LinkedIn moved post list to /creator/top-posts/ URL"
```

### Task 9: Add post count anomaly detection

**Files:**
- Modify: `extension/src/background/service-worker.ts`
- Modify: `server/src/db/queries.ts` (or wherever `logScrape` is defined)
- Modify: `server/src/app.ts`

- [ ] **Step 1: Track expected vs actual post count on the server**

Add a `sync_warnings` column to scrape_log or use the existing `error_details` field. In the `/api/ingest` endpoint in `server/src/app.ts`, after processing posts, compare the incoming post count against the historical average:

```typescript
    // Sync health check: detect post count anomalies
    if (payload.posts && payload.posts.length > 0) {
      const avgRow = db
        .prepare(
          `SELECT AVG(posts_count) as avg_count FROM (
             SELECT posts_count FROM scrape_log
             WHERE posts_count > 0
             ORDER BY id DESC LIMIT 10
           )`
        )
        .get() as { avg_count: number | null };

      if (avgRow.avg_count && payload.posts.length < avgRow.avg_count * 0.3) {
        const warning = `Post count anomaly: got ${payload.posts.length}, expected ~${Math.round(avgRow.avg_count)}. LinkedIn may have changed their page structure.`;
        console.warn(`[Sync Health] ${warning}`);
        upsertSetting(db, "sync_warning", JSON.stringify({
          message: warning,
          detected_at: new Date().toISOString(),
          expected: Math.round(avgRow.avg_count),
          actual: payload.posts.length,
        }));
      } else {
        // Clear warning if count looks normal
        const existing = getSetting(db, "sync_warning");
        if (existing) {
          db.prepare("DELETE FROM settings WHERE key = 'sync_warning'").run();
        }
      }
    }
```

Note: Import `getSetting` and `upsertSetting` from `./db/ai-queries.js` — they're already used in the app via dynamic imports, but for this sync check, add a static import at the top of `app.ts` or use the existing `db.prepare` pattern inline.

- [ ] **Step 2: Commit**

```bash
git add server/src/app.ts
git commit -m "feat: detect post count anomalies on sync, store warning in settings"
```

### Task 10: Add selector health checks in content script

**Files:**
- Modify: `extension/src/content/index.ts`

- [ ] **Step 1: Enhance error reporting with selector diagnostics**

The `requireSelector` function at line 52-63 already throws when selectors are missing. Enhance the error message to include what selectors ARE present, to help diagnose what LinkedIn changed to:

```typescript
async function requireSelector(
  selector: string,
  pageName: string
): Promise<void> {
  const el = await waitForSelector(selector);
  if (!el) {
    // Gather diagnostic info about what IS on the page
    const bodyClasses = document.body.className;
    const mainSelectors = [
      ".member-analytics-addon__mini-update-item",
      ".member-analytics-addon-card__base-card",
      ".member-analytics-addon-summary__list-item",
      ".artdeco-card",
      "[data-test-id]",
    ];
    const found = mainSelectors
      .filter((s) => document.querySelector(s))
      .join(", ");

    throw new Error(
      `[${pageName}] Expected selector "${selector}" not found. ` +
        `LinkedIn may have changed their page structure. ` +
        `Page has: ${found || "no known selectors"}. ` +
        `Body classes: ${bodyClasses.slice(0, 200)}`
    );
  }
}
```

This error propagates back to the service worker and gets logged, making it much easier to diagnose what changed.

- [ ] **Step 2: Commit**

```bash
git add extension/src/content/index.ts
git commit -m "feat: add selector diagnostics to content script error reporting"
```

### Task 11: Add staleness detection on the server

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/routes/insights.ts` (or `settings.ts`)

- [ ] **Step 1: After ingest, check if newest scraped post is stale**

In the `/api/ingest` handler in `server/src/app.ts`, after upserting posts, compare the newest ingested post's `published_at` against the server's current time. If the newest post is more than 48 hours old but there's clear evidence the user has been posting (e.g., we've seen posts at a regular cadence), flag it:

```typescript
    // Staleness detection: newest scraped post shouldn't be much older than expected
    if (payload.posts && payload.posts.length > 0) {
      const newestPost = payload.posts.reduce((a, b) =>
        new Date(a.published_at) > new Date(b.published_at) ? a : b
      );
      const newestAge = Date.now() - new Date(newestPost.published_at).getTime();
      const twoDaysMs = 48 * 60 * 60 * 1000;

      // Check average posting frequency from DB
      const freqRow = db
        .prepare(
          `SELECT COUNT(*) as count FROM posts
           WHERE published_at > datetime('now', '-30 days')`
        )
        .get() as { count: number };

      // If user posts frequently (>2/week) but newest scraped post is >48h old, warn
      if (freqRow.count >= 8 && newestAge > twoDaysMs) {
        const warning = `Stale sync: newest scraped post is ${Math.round(newestAge / 3600000)}h old, but you typically post ${freqRow.count} times/month. A recent post may be missing.`;
        console.warn(`[Sync Health] ${warning}`);
        upsertSetting(db, "sync_stale_warning", JSON.stringify({
          message: warning,
          detected_at: new Date().toISOString(),
          newest_post_age_hours: Math.round(newestAge / 3600000),
        }));
      } else {
        const existing = getSetting(db, "sync_stale_warning");
        if (existing) {
          db.prepare("DELETE FROM settings WHERE key = 'sync_stale_warning'").run();
        }
      }
    }
```

- [ ] **Step 2: Add a sync health endpoint**

In `server/src/routes/settings.ts`, add an endpoint that returns all active warnings:

```typescript
  app.get("/api/settings/sync-health", async () => {
    const warning = getSetting(db, "sync_warning");
    const staleWarning = getSetting(db, "sync_stale_warning");
    return {
      warnings: [
        ...(warning ? [JSON.parse(warning)] : []),
        ...(staleWarning ? [JSON.parse(staleWarning)] : []),
      ],
    };
  });
```

- [ ] **Step 3: Surface warnings in the dashboard**

Add a sync health check to the Overview page (`dashboard/src/pages/Overview.tsx`). On mount, fetch `/api/settings/sync-health`. If warnings exist, display a yellow banner at the top:

```tsx
{syncWarnings.length > 0 && (
  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-sm text-yellow-200">
    <span className="font-medium">Sync issue detected:</span>{" "}
    {syncWarnings[0].message}
  </div>
)}
```

Add corresponding API client method:

```typescript
  getSyncHealth: () =>
    get<{ warnings: Array<{ message: string; detected_at: string }> }>("/settings/sync-health"),
```

- [ ] **Step 4: Commit**

```bash
git add server/src/app.ts server/src/routes/settings.ts dashboard/src/api/client.ts dashboard/src/pages/Overview.tsx
git commit -m "feat: add staleness detection and sync health warnings in dashboard"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Cost calculation helper | `client.ts` (server) |
| 2 | Split pipeline into tagging + full | `orchestrator.ts`, `ai-queries.ts` |
| 3 | Two-tier auto-trigger on sync | `app.ts` |
| 4 | Settings + run history API endpoints | `settings.ts`, `insights.ts` |
| 5 | Dashboard API client methods | `client.ts` (dashboard) |
| 6 | Settings page redesign | `Settings.tsx` |
| 7 | Backfill existing run costs | `insights.ts` |
| 8 | Fix LinkedIn URL change | `service-worker.ts` |
| 9 | Post count anomaly detection | `app.ts` |
| 10 | Selector health checks | `content/index.ts` |
| 11 | Staleness detection + dashboard warnings | `app.ts`, `settings.ts`, `Overview.tsx` |
