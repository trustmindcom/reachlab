/**
 * Pre-extracted LinkedIn platform knowledge for the ghostwriter agent.
 * Sourced from linkedin-knowledge.md and ai-insights-research.md.
 * No runtime file reads — all content is static strings.
 */

export const PLATFORM_KNOWLEDGE: Record<string, string> = {
  hooks: `## Hook Type Analysis

Only the first 210-235 characters are visible before "See more". 60-70% of potential readers are lost at this decision point.

| Hook Type | Description | Strength |
|-----------|-------------|----------|
| Question | Opens with direct question | Drives comments |
| Bold Claim | Contrarian/surprising statement | Stops the scroll |
| Story | "Last Tuesday, I got fired..." | Emotional engagement, dwell time |
| Statistic | Leads with surprising number | Establishes credibility |
| Listicle | "5 ways to..." | 20-30% more dwell time |
| Contrarian | "Unpopular opinion: X is dead" | Polarization drives comments |
| Vulnerable | Admits failure, shares struggle | High saves and follows |`,

  closings: `## Closing Strategies

Synthesized from engagement research and platform knowledge:

**Call-to-Action (CTA) Types:**
- **Question CTA**: End with a specific question to drive comments. Comments are ~15x more valuable than likes for distribution.
- **Share CTA**: Ask readers to share with someone specific ("Tag a founder who needs this"). Shares/reposts are ~5x baseline weight.
- **Save CTA**: Prompt saves for reference value ("Save this for your next 1:1"). Saves lead to 130% higher follow probability.
- **Soft CTA**: End with a reflective statement that invites agreement or disagreement without explicitly asking.

**Closing Patterns That Work:**
- Restate the core insight in one punchy line (reinforces the takeaway for skimmers).
- End with a vulnerable admission or honest uncertainty (drives authentic comments over generic reactions).
- Provide a concrete next step the reader can take today (practical value drives saves).
- Create a "choose your side" moment on a genuine professional tension (drives comment threads, which boost reach ~2.4x vs top-level-only comments).

**What to Avoid:**
- Generic "thoughts?" or "agree?" — these produce low-quality one-word comments that the algorithm's NLP scoring devalues.
- Multiple CTAs — pick one action. Paradox of choice reduces all engagement.
- Hashtag blocks at the end — hashtags are essentially irrelevant for distribution in the 2026 algorithm.`,

  length: `## Optimal Post Length

| Length | Performance | Best Use |
|--------|-------------|----------|
| <500 chars | Underperforms | Quick hot takes only |
| 500-900 chars | Good | Engagement drivers, questions |
| 1,300-1,900 chars | **Peak zone** | Deep insight, storytelling |
| >2,000 chars | Diminishing returns | Only if extremely compelling |`,

  format: `## Content Format Performance (2025-2026 Data)

| Format | Avg Engagement Rate | Notes |
|--------|-------------------|-------|
| Multi-image posts | **6.60%** | Highest engagement |
| Document carousels | **6.10%** | 278% more than video, 596% more than text-only |
| Video | **5.60%** | But crashed 35% YoY; only 18% watch past 1 min |
| Polls | 1.64x reach multiplier | Highest impressions generator |
| Text + image | Strong | 58% of all LinkedIn content uses images |
| Text-only | Lowest tier | Unless sharp and compelling |

Additional context from LinkedIn engineering:
- Single-image posts dropped 30% below text-only in 2026 — because the text-only retrieval system can't see images. Substantial captions compensate.
- Carousel optimal length: 6-9 slides (down from 12-13 in 2024). Below 35% slide click-through, posts get a visibility penalty.
- External links lose ~60% reach vs native content.
- Video views declined 36% YoY despite increased posting. Text-only retrieval disadvantages video without rich captions/transcripts.
- Newsletters bypass the algorithm entirely (triple notification: email + push + in-app). Accounts with newsletters get 2.1x reach on regular posts (halo effect).`,

  engagement: `## Engagement Quality Hierarchy

Not all engagement is equal. LinkedIn's algorithm weights signals differently:

| Signal | Approximate Weight | What It Indicates |
|--------|-------------------|-------------------|
| Meaningful comments (15+ words) | ~15x baseline | Post provoked genuine thought |
| Shares/Reposts (with context) | ~5x baseline | Worth staking social capital on |
| Saves | ~3x baseline | Lasting reference value; 130% higher follow probability |
| Sends (DM shares) | ~3x baseline | High-trust private recommendation |
| Reactions (likes etc.) | 1x baseline | Low-friction; weakest signal |

Key ratio: Comments approaching 50% of total reactions = deep resonance, not passive scrolling.

Quality signals (saves, thoughtful comments) are 4-6x more important than likes under the new algorithm.

## Engagement Rate Benchmarks (2026)

Engagement rate is a dilution metric — it mechanically drops as impressions grow because the algorithm expands from the warm network (high affinity) to strangers (low affinity). Use account-size baselines, not platform-wide thresholds:

- <1K followers: 6-8% typical
- 1-5K followers: 4-6% typical
- 5-10K followers: 3.5-5% typical
- 10-25K followers: 3-4.5% typical
- 25-50K followers: 2.5-4% typical
- 50-100K followers: 2-3.5% typical
- 100K+ followers: 1.5-3% typical

**Critical**: compare a post's rate against the user's own historical baseline for their account size, not a flat threshold. A 0.3% rate on a 100K-impression post is not "failing" — it is the mathematical consequence of reaching 10-20x the user's median reach. Check absolute engagement count and follower delta to judge whether a high-reach post was actually successful.

Power-law reality: top 1% of posts outperform the median by ~237x (van der Blom 2025, 1.8M posts). The rare outlier posts drive most of the account's total impact. Never coach the user toward the middle of the distribution; coach them to replicate what produced outliers.`,

  timing: `## The "Golden Hour"

LinkedIn shows your post to 2-5% of your network in the first 60 minutes. Engagement quality during this window determines whether you get platform-wide amplification. Posts maintaining high engagement receive distribution for 48-72 hours.

Creator reply within 15 minutes gives ~90% boost (GrowLeads). Mechanism confirmed: fresh interaction signals during the highest-weight window of the Feed SR model's recency-weighted loss function.

Peak engagement shifted to 3-8 PM in 2026 (Buffer, 4.8M posts).

Content can distribute for 1-3 weeks (not just 48-72 hours) under the 2026 percentile-based freshness system.

## Posting Frequency

Buffer's analysis of 2M+ posts: posting more frequently does NOT hurt per-post performance. It actually increases it:

| Frequency | Impressions Per Post vs 1x/week |
|-----------|-------------------------------|
| 2-5x/week | +1,182 impressions/post |
| 6-10x/week | +5,001 impressions/post |

Sweet spot: 2-5 posts per week (balances growth with sustainability).

Higher posting frequency = better per-post performance (Buffer, 2M+ posts, fixed-effects regression). No cannibalization effect. The jump from 1 to 2-5 posts/week is the biggest marginal lift.`,

  comments: `## Comments

- Comment quality is scored via NLP/ML (XGBoost for triage, 360Brew 150B-parameter LLM for substance/lexical diversity), not word-count heuristics. A 5-word specific question may score higher than a 50-word generic response.
- Threaded conversations (replies to comments) boost reach ~2.4x vs top-level-only comments (AuthoredUp, 621K posts).
- Commenter identity matters. LinkedIn's Qwen3 0.6B model generates profile embeddings encoding professional identity. Comments from people whose expertise semantically matches the post topic carry more weight.
- Pod-like behavior (repetitive phrasing across multiple comments) is specifically detected and devalued via lexical diversity analysis.
- Comments are ~15x more valuable than likes for distribution (Postiv AI, 2M posts). Mechanism confirmed but exact multiplier uncertain.`,

  dwell_time: `## Dwell Time

- The P(skip) model is content-type-relative (percentile-based, not absolute seconds). It asks: "did this hold attention longer than similar posts of its type?"
- Clicking "see more" is a positive engagement signal that starts/extends the dwell time clock. Posts earning the click AND holding attention past ~15 seconds get a reach multiplier.
- Content completion rate matters more than raw engagement. A 5-slide carousel viewed completely outperforms a 100-slide carousel with more likes.

Dwell time is used internally as a ~3:1 weighted signal vs likes. Not exposed to creators, but proxied by:
- Save rate (people plan to re-read)
- Comment depth/quality (indicates careful reading)
- Profile views per post (content provoked enough interest to check you out)
- Video watch duration

Posts with 61+ seconds dwell time average 15.6% engagement vs 1.2% for 0-3 seconds.`,

  topic_authority: `## Topic Authority

- 360Brew requires 60-90 days of consistent posting on 2-3 focused topics before recognizing expertise and optimizing distribution. Topic-hopping causes depressed reach.
- The system cross-references post content against the author's profile (headline, about, experience). Content misaligned with stated expertise gets suppressed.
- 80%+ of content should be within 2-3 core topics for proper classification.`,
};
