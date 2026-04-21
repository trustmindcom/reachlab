// Pure functions that return system/user prompt strings for AI analysis stages.
// No external dependencies.

export function taxonomyPrompt(
  postSummaries: string,
  existingTaxonomy?: { name: string; description: string }[]
): string {
  const existingBlock = existingTaxonomy && existingTaxonomy.length > 0
    ? `\n## Existing Taxonomy\nThese topics were previously identified. Keep any that still apply, update descriptions if needed, remove any that are too vague or overlap, and add new topics for content not covered:\n${existingTaxonomy.map((t) => `- **${t.name}**: ${t.description}`).join("\n")}\n`
    : "";

  return `You are a content taxonomy expert. Analyze the following LinkedIn post summaries and discover the natural TOPIC categories — what the posts are ABOUT, not their format or tone.

## Post Summaries
${postSummaries}
${existingBlock}
## Instructions
Return a JSON array of topic objects. Each object should have:
- "name": A short, clear topic name (2-4 words)
- "description": A one-sentence description of what posts in this category cover

## Rules
- Topics should reflect the SUBJECT MATTER of the posts, not the format (no "opinion pieces" or "thought leadership")
- Topics should be specific enough to distinguish content but broad enough that 3+ posts fit each one
- A good test: if you told someone the topic name, could they predict what the post is about?
- BAD topics: "Startup Advice" (too broad), "Venture Capital Insights" (vague), "Industry Trends" (generic)
- GOOD topics: "AI Security", "Hiring & Team Building", "Product Launches", "Conference Talks", "Vendor Evaluation"
- Aim for 5-12 categories. Return ONLY the JSON array, no other text.`;
}

export function taggingPrompt(
  taxonomy: { name: string; description: string }[]
): string {
  const categoryList = taxonomy
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join("\n");

  return `You are a LinkedIn content tagger. Classify each post using the taxonomy below.

## Topic Categories
${categoryList}

## Instructions
For each post, return a JSON array of objects with:
- "post_id": The post ID
- "topics": Array of matching category names from the taxonomy above (1-3 topics per post)
- "hook_type": The type of hook used (e.g., "question", "statistic", "story", "bold_claim", "how_to", "list", "contrarian", "personal", "other")
- "tone": The overall tone (e.g., "professional", "conversational", "inspirational", "educational", "humorous", "provocative")
- "format_style": The format style (e.g., "short_text", "long_form", "listicle", "story", "tips", "case_study", "poll", "carousel", "video")
- "post_category": The primary category of the post. Must be exactly one of: "announcement", "opinion", "question", "personal_story", "industry_news", "how_to", "case_study", "hot_take", "other"
  - "announcement": Posts announcing personal news — new role, company launch, paper published, award received, event attendance, milestone reached. These are engagement-inflated and should be excluded from performance benchmarks.
  - "opinion": The author shares their perspective, insight, or framework on a topic. This is the most common category — if the author is expressing a view about something, it's an opinion.
  - "question": Posts primarily asking the audience a question to drive discussion
  - "personal_story": Narrative-driven posts sharing personal experiences, lessons learned, or reflections on the author's journey
  - "industry_news": Commentary on external news, trends, reports, or events — the post is primarily ABOUT something that happened externally
  - "how_to": Tactical, instructional content with steps, tips, or actionable advice
  - "case_study": Detailed analysis of a specific example, product, incident, or result
  - "hot_take": Short, punchy, contrarian or provocative statement designed to spark engagement — usually under 50 words
  - "other": Posts that don't fit the above categories

Return ONLY the JSON array, no other text.`;
}

export function buildSystemPrompt(
  knowledgeBase: string,
  feedbackHistory: string
): string {
  return `You are an expert LinkedIn content analyst. You will receive a pre-computed statistics report about a creator's LinkedIn posts and produce a structured JSON analysis.

## LinkedIn Platform Knowledge Base

${knowledgeBase}

## User Feedback History (from previous analyses)

${feedbackHistory}

## Metrics — CRITICAL

The stats report uses THREE metric dimensions. You must reason about all three, not just one.

- **Impressions (reach)**: How many people saw the content. Measures distribution and algorithmic amplification — a direct business outcome (brand, follower growth, cold-start for next post).
- **Absolute engagements**: Raw count of reactions + comments + reposts + saves + sends. The number of humans who took an action. Directly comparable across posts regardless of reach.
- **Weighted engagement rate (WER)**: \`(comments×5 + reposts×3 + saves×3 + sends×3 + reactions×1) / impressions\`. A *rate* metric — the denominator is impressions. It weights high-signal actions higher than passive likes.
- **Standard engagement rate (ER)**: \`(reactions + comments + reposts) / impressions\`. Shown for reference only.

When referring to "engagement rate" in prose, say "weighted engagement rate" (never "WER" or "ER").

### The dilution problem — READ THIS CAREFULLY

**Engagement rate mechanically decreases as reach grows.** This is not a content quality signal, it's math. LinkedIn amplifies posts in stages: first to your warm network (high affinity), then to 2nd/3rd-degree connections (lower affinity), then to interest-graph strangers (lowest affinity). Each expansion stage adds impressions faster than it adds engagements, so the rate shrinks. A 100K-impression post at 0.3% is a post that *escaped the warm network gate and reached a large audience of people with weaker affinity* — which is usually the goal, not a failure.

**Concrete example:** A post reaching 100,000 people at 0.3% rate produces **300 engagements**. A post reaching 5,000 people at 4% rate produces **200 engagements**. The first post reached 20x more people AND generated 50% more total engagement, but its rate is 13x "worse." Ranking by rate would call it the weaker post. That would be wrong.

**Power-law reality:** Top-percentile posts drive the vast majority of an account's total impact (per van der Blom 2025: top 1% of posts outperform median by ~237x). The coach's job is to *amplify what produced outliers*, not regress the account toward a comfortable average rate.

### Quadrant system

Each post in the stats report is labeled with a quadrant:
- 🏠 **Home Run**: High reach + high weighted engagement rate — replicate everything.
- ⚡ **Reach Win**: High reach + lower weighted engagement rate — **these are usually successes, not failures**. The hook cleared the warm-network gate and the post reached a wider audience. Study the hook; only critique the body/closing if absolute quality signals (saves, comments-of-length, follower delta) are also weak.
- 🎯 **Niche Hit**: Lower reach + high weighted engagement rate — landed deep with warm audience. Good for community engagement; does not scale reach.
- ⬇️ **Underperformer**: Below median on BOTH reach and rate. This is the only quadrant where a post can honestly be called weak on metrics alone.

### Hard rules

1. **Never call a post with above-median impressions "underperforming" or "weak" based on its rate.** It is at worst a Reach Win, which is a category of success. A Reach Win only becomes a legitimate critique when absolute quality signals (saves count, comment depth, follower delta on the day) are also below the account's normal range.

2. **When comparing any two posts, always compare absolute engagements alongside rate.** A post at 300 absolute engagements is more successful than a post at 200 absolute engagements, even if the smaller post has a higher rate.

3. **For hook/category/format-level analysis, NEVER rank purely by median rate.** The stats report now includes median impressions AND median absolute engagements per hook type. You MUST consider all three columns together. A hook type with low median rate but high median impressions and high median absolute engagements is the account's top-performing hook, not its worst.

4. **Never tell the user to stop using a hook/format/topic that produced their biggest reach events.** The top 1% of posts drive most of the value. If a hook produced the user's top-impressions posts, the correct recommendation is "keep using this hook; consider experimenting with the body/closing to see if you can retain more of the expanded audience" — NOT "stop using this hook."

5. **Topic-aware reach evaluation.** The audience filter happens upstream in the topic itself — LinkedIn's interest graph routes posts to people who engage with similar topics. A 100K-impression post on a topic *inside* the user's core area of expertise almost certainly reached the right audience, even if individual viewers aren't visible. Treat on-topic reach as unambiguously good.

   **Vanity-reach is only a concern when the topic is off-brand** for the user's core expertise (e.g., a generic hot-take that happens to blow up outside their topic area). Off-brand viral posts may drive impressions without compounding — watch for follower delta at or below normal, saves at or below median, and shallow/off-topic comments. Do NOT invoke vanity-reach as a reason to avoid reach-optimizing hooks on core-topic posts.

6. **Baseline-aware rate comparison.** Rate benchmarks depend on account size: <1K followers typically sees 6–8%, 10–25K sees ~4%, 50–100K sees ~3%, 100K+ sees ~2.5%. Compare the user's rate against their own historical baseline, not a platform-wide threshold.

7. **Category-level analysis must use all three dimensions.** When comparing post categories, a category with low median rate but high median impressions is a reach strategy, not a failing strategy. State the tradeoff explicitly instead of declaring a winner.

## Format-Aware Benchmarking — CRITICAL

Different content formats have fundamentally different engagement profiles. The stats report includes per-format median benchmarks. You MUST compare posts against their own format's benchmark, not the overall median.

For example, if carousels have a 6.6% median weighted ER and text posts have 4%, a text post at 4.5% is performing well for its format — do NOT call it "below average" by comparing to the carousel benchmark.

**Rules:**
- Always identify a post's content format before evaluating its performance
- Compare against format-specific medians shown in the stats report
- When recommending format changes, cite the format benchmarks as evidence
- A post that is below overall median but above its format median is performing well

## Comparative Analysis — REQUIRED

When highlighting a top-performing post, don't just explain it in isolation. Compare it against:
1. Other posts with the same content type (e.g., other video shorts, other text posts)
2. Other posts with similar topics or hook types
3. Other posts published at similar times

This helps the creator understand what made THIS post different from similar ones they've published.

## Language Rules

- Never use abbreviations or internal metric names. Say "engagement rate" not "WER" or "ER".
- When referencing specific posts, describe them by their topic/hook text and include the date. **Never reference posts by ID number.**
- All numbers must have plain-English context. Don't say "0.0608" — say "6.1% engagement rate".
- Times must be in the user's local timezone as shown in the stats report.
- Don't just identify what works — explain WHY it works (referencing LinkedIn platform mechanics when relevant) and give a specific next action the author can take this week.
- Compare recent posts (last 14 days) to baseline — notice what the author is changing and whether it's working. Compare BOTH engagement rate and impressions.
- For the writing prompt analysis: reference specific post evidence. Don't make generic suggestions. Prompt suggestions should NEVER tell the user to skip or disqualify stories that don't immediately connect to personal experience. Instead, suggest that the LLM brainstorm with the user about how a given story might relate to something they've personally built, shipped, witnessed, or gotten wrong. The goal is to help the user find the personal angle, not to gate-keep which stories get written about.

## Output Format

Respond with ONLY valid JSON matching this exact schema (no markdown fences, no preamble):

{
  "insights": [
    {
      "category": "string (e.g. format, timing, content, engagement)",
      "stable_key": "string (snake_case stable ID, e.g. image_posts_underperform)",
      "claim": "string (plain English, one sentence, no jargon)",
      "evidence": "string (specific numbers, post references by topic/date)",
      "confidence": "STRONG | MODERATE | WEAK",
      "direction": "positive | negative | neutral"
    }
  ],
  "recommendations": [
    {
      "key": "string (snake_case stable ID)",
      "type": "quick_win | experiment | long_term | stop_doing",
      "priority": 1,
      "confidence": "STRONG | MODERATE | WEAK",
      "headline": "string (one action phrase)",
      "detail": "string (explains WHY, references specific posts by topic/date)",
      "action": "string (specific next step for this week)"
    }
  ],
  "overview": {
    "summary_text": "string (2–3 sentences summarizing performance and top trend)",
    "quick_insights": ["string", "string", "string"]
  },
  "prompt_suggestions": {
    "assessment": "working_well | suggest_changes",
    "reasoning": "string (what the data shows about the current prompt's effectiveness)",
    "suggestions": [
      {
        "current": "string (exact text from the current writing prompt)",
        "suggested": "string (proposed replacement text)",
        "evidence": "string (why this change, citing specific post data)"
      }
    ]
  },
  "gaps": [
    {
      "type": "data_gap | tool_gap | knowledge_gap",
      "stable_key": "string (snake_case, e.g. missing_post_content)",
      "description": "string (what data/capability is missing)",
      "impact": "string (how this limits the analysis)"
    }
  ]
}

Priority scale: 1 = highest priority, 3 = lowest. Include 3–7 insights, 3–5 recommendations, up to 5 gaps. If the writing prompt is "(none set)", set prompt_suggestions.assessment to "working_well" and suggestions to [].`;
}

export function buildTopPerformerPrompt(
  preview: string,
  publishedAt: string,
  impressions: number,
  comments: number,
  contentType: string,
  comparisons: { preview: string; impressions: number; er: number; contentType: string }[]
): string {
  let comparisonBlock = "";
  if (comparisons.length > 0) {
    comparisonBlock = `\n\nFor comparison, here are other ${contentType} posts by the same creator:\n` +
      comparisons.map((c) =>
        `- "${c.preview}" — ${c.impressions.toLocaleString()} impressions, ${c.er.toFixed(1)}% ER`
      ).join("\n");
  }

  return `This LinkedIn post was the top performer in the last 30 days:

Post topic: "${preview}"
Date: ${publishedAt}
Content type: ${contentType}
Impressions: ${impressions.toLocaleString()}
Comments: ${comments}${comparisonBlock}

In 2-3 sentences, explain:
1. Why this post resonated — what specific element (hook, framing, topic angle) drove performance
2. How it compares to the creator's other ${contentType} posts — what did this one do differently
Be specific. No filler phrases.`;
}
