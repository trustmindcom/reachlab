# Onboarding Flow Design

## Goal

When a new user opens ReachLab for the first time, guide them through setup so they get personalized topic bubbles and can generate posts without any manual configuration. A non-technical user (e.g., someone who writes about travel) should be able to complete this without knowing what RSS, taxonomy, or writing prompts are.

## Architecture

Single-page wizard rendered instead of the main app when `onboarding_complete` is not set in the `settings` table. Each step commits results to the database as it completes. The wizard uses local React state for step progression (matching the existing `Generate.tsx` pattern). On completion, sets `onboarding_complete = true` and reloads the app.

## Decisions Made

- **Approach:** Full setup flow with skip options at each step
- **Extension install:** Guided walkthrough with instructions (not animations)
- **Voice interview:** Voice only (reuse existing `InterviewModal` + `useRealtimeInterview`)
- **Source discovery:** Claude Agent SDK to browse the web, verify URLs, handle both RSS and website scraping
- **Structure:** Welcome page → step-by-step wizard
- **Welcome layout:** Centered & minimal (clean hero, numbered step preview, single CTA)

---

## Step-by-Step Flow

### Entry Point: App.tsx

On mount, check `GET /api/settings/onboarding_complete`. If falsy or missing, render `<OnboardingWizard onComplete={() => window.location.reload()} />` instead of the normal header/tabs/content. No new tables — just one new key in the existing `settings` table.

### Step 0: Welcome Page

Centered layout showing:
- ReachLab logo/title
- One-line value prop: "Write LinkedIn posts that sound like you, powered by AI that knows your voice."
- Three numbered preview cards (1: Connect LinkedIn, 2: Voice Interview, 3: Find Sources)
- "Get started" CTA button
- Subtitle: "~10 minutes · makes everything work better"

This is a static page. Clicking "Get started" advances to Step 1.

### Step 1: Install Chrome Extension

**What the user sees:**
- Heading: "Connect LinkedIn"
- Instructions: "Install the ReachLab Chrome extension to import your LinkedIn posts."
- Three sub-steps:
  1. Open `chrome://extensions` (with a copy-to-clipboard button for the URL)
  2. Enable "Developer mode" (toggle in top-right)
  3. Click "Load unpacked" and select the extension folder
- A "Check connection" button that calls `GET /api/health` to verify the extension can talk to the server
- Once connected: green checkmark, "Connected!" message, "Continue" button enabled
- Skip link: "I'll do this later" → advances to next step

**What happens on the server:** Nothing new — the existing `/api/health` endpoint is sufficient.

**Post-connection automation:** After the extension connects, the user needs to visit LinkedIn to trigger the first sync. The wizard should:
1. Show a "Now visit LinkedIn" prompt with a link to `https://www.linkedin.com/analytics/creator/content/`
2. Poll `GET /api/health` every 3 seconds checking for `last_sync_at` to be set
3. When posts arrive, show "Found X posts!" and enable Continue

If the user skips, they get no posts analyzed and later steps (taxonomy, writing prompt) will work with empty data, which is fine — they'll populate on next sync.

### Step 2: Analyze Your Writing

**What the user sees:**
- Heading: "Analyzing your posts..."
- Scanner animation (reuse existing `ScannerLoader` from `DiscoveryView.tsx`)
- Progress messages: "Reading your posts...", "Finding your topics...", "Building your writing profile..."
- When done: show the discovered topics as tags/pills (from `ai_taxonomy`), show the auto-generated writing prompt in a read-only textarea
- "Looks good" button to continue, or "Edit" to tweak the writing prompt before proceeding

**What happens on the server:**
- Trigger `POST /api/ai/refresh` (existing endpoint that runs taxonomy + analysis)
- After analysis completes, call `GET /api/writing-prompt` to get the auto-generated prompt
- Poll analysis status via `GET /api/ai-runs` until complete

**If no posts exist** (user skipped Step 1): Show a message "No posts to analyze yet. You can come back to Settings later after your first sync." and skip to Step 3.

### Step 3: Voice Interview (Optional)

**What the user sees:**
- Heading: "Tell us about yourself"
- Explanation: "A 5-minute voice conversation to capture what makes your perspective distinctive. This helps the AI write in your voice."
- Pre-interview form (name, role, company, bio) — same as existing `InterviewModal`
- "Start Interview" button → opens the voice interview (reuse `useRealtimeInterview` hook)
- After interview: show extracted profile for review (same review UI as existing modal)
- Skip link: "Skip for now" → continues without interview

**What happens:** Reuse the existing interview infrastructure entirely:
- `POST /api/author-profile/interview/session` → get ephemeral OpenAI token
- WebRTC connection via `useRealtimeInterview` hook
- `POST /api/author-profile/extract` → extract profile from transcript
- `POST /api/author-profile` → save profile

### Step 4: Find Your Sources

**What the user sees:**
- Heading: "Set up your news sources"
- Explanation: "We'll find websites and feeds relevant to what you write about, so we can suggest timely topics."
- Auto-discovery runs immediately using the topics from Step 2
- Show a list of discovered sources with checkboxes (pre-checked)
- User can uncheck sources they don't want
- Manual "Add a website" input at the bottom (same as existing Sources tab)
- "Save sources" button → saves selected sources
- Skip link: "Use defaults" → keeps the default feeds from migration 011

**What happens on the server:**
- New endpoint: `POST /api/sources/discover` — takes the user's taxonomy topics, uses Perplexity Sonar Pro to:
  1. Search for relevant blogs, newsletters, and news sources for each topic (limited to 10 topics)
  2. For each candidate URL, attempt RSS feed discovery (reusing existing `discoverFeeds` + `discoverFeedsByGuessing`)
  3. Return a list of `{ name, url, feed_url, description }` suggestions
- User selections are saved via existing `POST /api/sources` endpoint

**Source discovery implementation:**
- Uses Perplexity Sonar Pro for web search (same API as research pipeline)
- Parses JSON array of source suggestions from the response
- Runs RSS feed discovery in parallel for all suggested sources
- Sources without RSS feeds are still returned (with `feed_url: null`) but not saved to the database since `research_sources.feed_url` is NOT NULL
- Future: Claude Agent SDK for more sophisticated browsing/verification

### Step 5: Done

**What the user sees:**
- Heading: "You're all set!"
- Summary of what was configured (X topics found, writing prompt generated, Y sources active)
- "Start writing" button → sets `onboarding_complete = true`, reloads app to Generate tab

**What happens:** `POST /api/settings` with `{ key: 'onboarding_complete', value: 'true' }`.

---

## Component Structure

```
dashboard/src/pages/onboarding/
  OnboardingWizard.tsx      — Step state machine, renders current step
  WelcomePage.tsx            — Step 0: hero + CTA
  ExtensionSetup.tsx         — Step 1: install extension + verify connection
  AnalyzeWriting.tsx         — Step 2: trigger analysis, show results
  VoiceInterview.tsx         — Step 3: wrapper around existing interview components
  SourceDiscovery.tsx        — Step 4: auto-discover + manual add
  SetupComplete.tsx          — Step 5: summary + finish
```

## Server Changes

1. **New endpoint:** `GET /api/settings/kv/:key` — returns `{ value }` or `404` (generic settings getter, namespaced under `/kv/` to avoid conflicts with existing specific settings endpoints)
2. **New endpoint:** `POST /api/settings/kv` with `{ key, value }` — upserts a setting
3. **New endpoint:** `POST /api/sources/discover` — Perplexity-powered source discovery with RSS feed detection
4. **No schema changes needed.** Uses existing `settings` table for `onboarding_complete` flag.

Note: Analysis polling uses existing `GET /api/insights/runs` endpoint. Writing prompt uses `GET /api/settings/writing-prompt`. Taxonomy uses `GET /api/insights/taxonomy`.

## Design Tokens

Reuse existing design system:
- Background: `bg-surface-0`, `bg-surface-2`
- Text: `text-text-primary`, `text-text-secondary`, `text-text-muted`
- Accent: `text-accent`, `bg-accent`
- Borders: `border-border`
- The wizard should feel like part of the same app, not a separate experience

## Edge Cases

- **No OPENAI_API_KEY:** Step 3 (voice interview) shows "Voice interview requires an OpenAI API key. You can configure this in your environment and do the interview later from Settings." + auto-skip
- **Server not running:** Welcome page should handle fetch failures gracefully with "Make sure the ReachLab server is running" message
- **Extension already installed:** Step 1 "Check connection" immediately succeeds → show "Already connected!" and auto-advance after 1 second
- **Already has posts:** Step 2 can detect existing posts and skip the "visit LinkedIn" prompt
- **Re-running onboarding:** Add a "Re-run setup" button in Settings that deletes the `onboarding_complete` key

## Out of Scope

- Packaging/distribution (Electron, Docker, etc.)
- Multi-user support
- Extension auto-install from Chrome Web Store
- Website scraping implementation (just RSS for now; `source_type: 'website'` flag reserved for future)
