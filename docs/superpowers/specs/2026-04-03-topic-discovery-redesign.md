# Topic Discovery Redesign — Magazine Grid with FLIP Expand

**Date:** 2026-04-03
**Status:** Approved

## Problem

The current topic discovery shows category-grouped pill bubbles with opaque labels like "Agentic Engineering Perspectives" — you can't tell what a topic is about without already knowing the news. There's also too much overlap between categories (4 categories all AI-related).

## Goals

1. **Magazine grid** — replace category bubbles with a flat grid of topic cards showing summary + source
2. **Click-to-expand detail** — FLIP animation expands selected card in place, siblings slide to new positions
3. **Source diversity** — backend enforces diverse sources across topics
4. **Guidance input** — expanded card has a textarea for the user's angle before writing

## Design

### 1. Topic Cards (Collapsed)

Each card shows:
- **Category tag** — color-coded pill (Supply Chain, AI Engineering, Trust & Safety, Dev Tools, Infrastructure, Strategy, etc.)
- **Title** — Newsreader serif, 17px, `gen-text-0`
- **Summary** — 1-2 lines, 14px, `gen-text-2`, clamped to 2 lines
- **Source + age** — "The Register · 2h ago" in `gen-text-3` / `gen-text-4`

Cards use the existing gen-* palette: `bg-gen-bg-1`, `border-gen-border-1`, `rounded-xl`. Hover shows `border-gen-border-2`.

Grid: `repeat(auto-fill, minmax(280px, 1fr))` with 12px gap — responsive from 1 to 3+ columns.

### 2. Click-to-Expand (FLIP Animation)

When a card is clicked:

1. Record `getBoundingClientRect()` for all cards
2. Add `.expanded` class to clicked card (becomes `grid-column: 1 / -1` — full width)
3. Calculate deltas (dx, dy, scaleX, scaleY) for each card's old→new position
4. Animate using Web Animations API:
   - **Hero card**: 2-keyframe direct morph, `transformOrigin: top left`
   - **Siblings**: 2-keyframe slide to new position, opacity 0.6→1
   - **Easing**: `cubic-bezier(0.16, 1, 0.3, 1)` (easeOutQuint — no overshoot)
   - **Duration**: 450ms
   - **Stagger**: 15ms base + 10ms × distance from clicked card

The expanded card reveals a two-column panel:
- **Left**: full summary, original source headline (italic), source link, source + age
- **Right**: "Your angle" label, guidance textarea, "Write about this" button

**Close**: X button (top-right, `bg-gen-bg-3` with border) + Escape key. Collapse uses same FLIP at 420ms.

**Switch**: Clicking another card while one is expanded does a single FLIP — old collapses, new expands, all siblings reposition simultaneously.

### 3. Category Tags

Color-coded but subtle — tinted backgrounds matching gen-* aesthetic:

| Tag | Background | Text |
|-----|-----------|------|
| Security/Supply Chain | `rgba(232,124,124,0.08)` | `#d4897e` |
| AI/Governance | `rgba(107,161,245,0.08)` | `#7eb3e8` |
| Dev Tools | `rgba(232,199,124,0.08)` | `#c8b07a` |
| Trust & Safety | `rgba(176,124,232,0.08)` | `#b090d4` |
| Infrastructure | `rgba(124,232,168,0.08)` | `#82c89e` |
| Strategy | `rgba(232,160,124,0.08)` | `#cca07a` |

### 4. Data Model Changes

**DiscoveryTopic** — add `summary` field:
```typescript
interface DiscoveryTopic {
  label: string;
  summary: string;           // NEW: 1-2 sentence summary
  source_headline: string;
  source_url: string;
  category_tag: string;       // NEW: short tag for color coding
}
```

**DiscoveryCategory** — remove. Topics are flat, not grouped. The `category_tag` on each topic replaces the category grouping.

**API response** changes from `{ categories: DiscoveryCategory[] }` to `{ topics: DiscoveryTopic[] }`.

### 5. Backend — Clustering Prompt Changes

Update `buildClusteringPrompt` in `server/src/ai/discovery.ts`:

- Return flat array of topics instead of categories
- Each topic includes a `summary` (1-2 sentences explaining the story angle)
- Each topic includes a `category_tag` (short label for color coding)
- **Enforce diversity**: max 2 topics per source domain, require at least 3 distinct source domains
- **Reduce overlap**: explicitly instruct "no two topics should cover the same story from different angles — each topic must be a distinct news item"
- Reduce from 12-15 topics to **8-10** for scannability

### 6. Frontend Changes

**Modify: `dashboard/src/pages/generate/DiscoveryView.tsx`**

Replace the category-bubbles section with the magazine grid + FLIP expansion. The topic input bar stays unchanged at the top. The "or explore trending topics" divider stays.

Key implementation details:
- FLIP logic as a utility function (record rects → apply DOM change → animate)
- `.expanded` card uses CSS `grid-column: 1 / -1` to span full width
- Expanded content is inside each card (toggled via `.expanded` class), not a separate panel element
- `card-collapsed` div shown when not expanded, `card-expanded` div shown when expanded
- Guidance textarea value passed to the existing `handleGoTopic` / research flow

**Modify: `dashboard/src/api/client.ts`**

Update `DiscoveryTopic` interface to include `summary` and `category_tag`. Remove `DiscoveryCategory`. Update `DiscoveryResponse` to `{ topics: DiscoveryTopic[] }`.

**Modify: `dashboard/src/pages/generate/DiscoveryView.tsx`**

Update to use flat `topics` array instead of `categories[].topics`.

### 7. Approved Mockup

The approved HTML mockup is at `.superpowers/brainstorm/9965-1775234150/magazine-grid-v7.html`. Implementation should match this exactly for layout, colors, typography, animation timing, and interaction behavior.

### 8. Files Modified

| File | Change |
|------|--------|
| `server/src/ai/discovery.ts` | Flatten output, add summary/category_tag, enforce diversity |
| `dashboard/src/pages/generate/DiscoveryView.tsx` | Replace bubbles with magazine grid + FLIP expand |
| `dashboard/src/api/client.ts` | Update DiscoveryTopic, remove DiscoveryCategory, update DiscoveryResponse |
