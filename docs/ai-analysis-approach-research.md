# AI Analysis Approach — Technical Research Document

> Compiled 2026-03-16 from deep research on agentic analysis, prompting strategies, self-critique patterns, and evolving AI systems. Evidence-backed recommendations for the LinkedIn analytics dashboard.

---

## Executive Summary

The analysis system should use a **single agentic LLM with SQL tools and structured prompting** — not multi-agent debate, not static prompts, not generic self-reflection. The evidence is clear:

- **Multi-agent debate** does not reliably outperform simpler methods (ICML 2024)
- **Generic self-reflection** often degrades reasoning quality (ICLR 2024)
- **Tool-grounded verification** (CRITIC pattern) produces substantial gains
- **Extended thinking** is more cost-effective than external critique loops
- **Self-consistency** (3x sampling) is the most cost-effective quality improvement

**Estimated cost**: ~$0.60-0.80 per full analysis run.

---

## Part 1: Agentic vs Static Prompts

### Why Static Prompts Are Insufficient

- **Brittleness**: Can only find patterns the prompt author anticipated
- **No iterative refinement**: Cannot notice a signal, drill deeper, then control for confounders
- **Context flooding**: Dumps all data upfront, wasting tokens on irrelevant information
- **Ordering bias**: Posts at top/bottom of payload get disproportionate attention

### The Recommended Middle Path

Use the `@anthropic-ai/sdk` with `toolRunner` via OpenRouter's Anthropic-compatible endpoint. This gives us the agentic loop (LLM decides what to query next) without the heavyweight Claude Code runtime.

**Key architecture decision**: Use the Anthropic SDK (not the Agent SDK). The Agent SDK runs the full Claude Code runtime — overkill for SQL queries against a database.

```
LLM → writes SQL query → tool executes against SQLite → results return → LLM reasons → more queries or final output
```

### Tools

Two tools only:

1. **`query_db`** — Executes read-only SQL SELECT against the analytics SQLite database. Schema description embedded in tool description. Results capped at 100 rows, formatted as markdown tables (more token-efficient than JSON).

2. **`submit_analysis`** — Structured output tool the LLM calls last to submit findings in a typed JSON schema. This is how we get structured output from the agentic loop.

**Why not code execution**: For 50-100 posts, every meaningful analysis can be expressed in SQL. SQLite supports window functions, CTEs, `strftime`, and conditional aggregations — everything an analytics agent needs. Code execution adds security complexity without proportional benefit at this scale.

### Hybrid Context Strategy

Pass a pre-computed summary (~200 tokens) PLUS the SQL tool:
- Summary anchors the LLM's understanding (prevents hallucination about data scale)
- Simple questions answered from context alone (zero tool calls)
- Complex questions use SQL for drilling deeper

### Cost & Latency

- **Model**: Sonnet via OpenRouter (~$0.02-0.05 per analysis with SQL tools)
- **Round trips**: 3-8 turns typical for comprehensive analysis
- **Latency**: 10-25 seconds total (stream progress to UI)
- **Max turns**: 15 (safety cap)

---

## Part 2: Structured Analytical Prompting

### The Core Problem

Naive prompts produce shallow correlations: "text posts outperform image posts." But is it the format, the topic, the hook, the posting time, or just coincidence? The LLM must reason about confounding variables and express appropriate uncertainty.

### Three-Stage Prompt Chain

Separates exploration, verification, and synthesis for debuggability. Each stage's output is stored in `ai_logs` for inspection.

**Stage 1: Pattern Detection (Exploratory)**
- LLM queries the database, identifies noteworthy patterns
- For each pattern: state the observation, generate 3+ explanations (including confounder-based), identify distinguishing tests
- Uses the SQL tool to compute actual statistics

**Stage 2: Hypothesis Testing (Focused)**
- LLM receives Stage 1 findings + the domain-specific confounder checklist
- For each finding: test alternative explanations against data, classify as SUPPORTED / PARTIALLY SUPPORTED / CONFOUNDED / INSUFFICIENT DATA
- Critical: confounded findings are STILL useful ("your image posts underperform not because of format, but because they're generic tips rather than personal stories")

**Stage 3: Synthesis (User-Facing)**
- LLM receives verified findings + uncertainty framework
- Produces 3-5 actionable recommendations with evidence strength labels
- Never says "X outperforms Y" without stating effect size and sample size

### Domain-Specific Confounder Checklist

Embedded in the Stage 2 prompt. Forces the LLM to check each finding against:

**Content confounders**: Topic/subject matter, content length, hook quality, CTA presence
**Timing confounders**: Day of week, time of day, seasonality, posting frequency
**Audience confounders**: Follower count at time of posting, algorithm changes, external amplification
**Measurement confounders**: Metric maturity (older posts had more time), impression threshold

### Evidence Strength Labels (Not Percentages)

Research shows LLMs are severely overconfident when asked for numerical confidence (ICLR 2025). They cluster at 80-100% regardless of actual uncertainty. Instead, use structured labels:

- **STRONG EVIDENCE**: Pattern consistent across subgroups, large effect size, confounders ruled out
- **MODERATE EVIDENCE**: Pattern visible but 1-2 confounders can't be ruled out
- **WEAK EVIDENCE / PRELIMINARY SIGNAL**: Small sample (<10 per group), multiple alternative explanations
- **INSUFFICIENT DATA**: Too few posts or wrong variables to test the claim

### Sample Size Guardrails

Hard rules embedded in every prompt:
- **<5 posts per group**: Do not draw conclusions. Flag as "potential area to explore."
- **5-10 posts**: Preface with "preliminary signal, based on small sample"
- **10-20 posts**: "Moderate evidence, though sample is limited"
- **20+ posts**: Standard confidence language
- Always report exact group sizes: "text posts (n=23) vs image posts (n=8)"

---

## Part 3: Why Not Multi-Agent Critique

### Self-Reflection Doesn't Work For Analytics

**Huang et al. (ICLR 2024)**: "Large Language Models Cannot Self-Correct Reasoning Yet." LLMs struggle to self-correct without external feedback. Performance often degrades after self-correction attempts. The detection step is the bottleneck — without new information, the model has no basis for changing its mind.

**TACL 2024 survey**: "No prior work demonstrates successful self-correction with feedback from prompted LLMs" except in very specific task types or with external feedback.

**Self-Refine (NeurIPS 2023)**: Showed ~20% improvement, but the rebuttal is that the improvement came from the refinement prompt giving the model more information about task requirements, not genuine error detection.

### Multi-Agent Debate Doesn't Outperform Simpler Methods

**"Should We Be Going MAD?" (ICML 2024)**: Evaluated 5 multi-agent debate frameworks across 9 benchmarks. Finding: current MAD methods fail to consistently outperform simpler single-agent strategies. Majority voting alone accounts for most gains typically attributed to debate.

**ICLR 2025 evaluation**: Confirmed majority voting alone explains most multi-agent gains. The debate mechanism itself adds little.

**MAST taxonomy (2025)**: Analyzed 1,642 traces across 7 multi-agent frameworks. Found 14 unique failure modes. Coordination gains plateau beyond 4 agents. The "bag of agents" anti-pattern produces a 17x error compounding effect.

### What Actually Works: Tool-Grounded Verification

**CRITIC framework**: When LLMs use external tools (SQL queries, code execution, calculators) to verify their claims, self-correction produces substantial gains. Critically, removing the tool verification step eliminated most gains. The model is not truly reflecting — it is reacting to ground truth provided by tools.

**Budget-Aware Evaluation (EMNLP 2024)**: Self-consistency (generate N responses, pick most common) consistently beats other reasoning strategies across all datasets with significantly less budget. Multi-agent debate can actually get worse with more compute.

### The Recommended Verification Architecture

Instead of a critic agent, use:

1. **Pre-computed confound checks in code** — Before the LLM runs, compute per-category breakdowns controlling for time, day, recency, and sample size. Include these in the prompt. This gives the LLM new information it can actually reason about.

2. **SQL-tool self-verification** — The agentic LLM can run follow-up queries to check its own hypotheses. This is the CRITIC pattern: verification via external tools, not via introspection.

3. **Self-consistency for recommendations** — Generate 3 independent recommendation sets, keep findings appearing in 2+. Most cost-effective quality improvement per the evidence. At ~$0.07 per recommendation run, 3x costs ~$0.21 total.

4. **Extended thinking** — Claude's extended thinking lets the model reason deeply before answering. More cost-effective than external critique loops for analytical reasoning.

---

## Part 4: Evolving Insights Over Time

### Data-Tiered Analysis

Gate analytical capabilities behind data thresholds:

| Tier | Posts | Capabilities |
|------|-------|-------------|
| 1: Foundation | 10-30 | Descriptive stats, simple rankings, content type comparison with caveats |
| 2: Patterns | 30-60 | Topic clustering, hook analysis, day-of-week analysis, initial recommendations |
| 3: Trends | 60-120 | Temporal trends, topic fatigue, statistical significance testing |
| 4: Prediction | 120-250 | Seasonal patterns, audience evolution, predictive engagement ranges |
| 5: Strategic | 250+ | Multi-variable analysis, content series analysis, algorithm sensitivity |

### The Analytical Ledger (Insight Memory)

Each analysis run produces a structured snapshot stored in SQLite. Insights link to their predecessors via a lineage table, creating a chain:

```sql
CREATE TABLE insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  claim TEXT NOT NULL,
  evidence TEXT NOT NULL,        -- JSON: sample sizes, values, breakdowns
  confidence TEXT NOT NULL,      -- 'strong', 'moderate', 'weak', 'insufficient'
  direction TEXT,                -- 'positive', 'negative', 'neutral', 'reversal'
  first_seen_run_id INTEGER,
  consecutive_appearances INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active'   -- 'active', 'weakening', 'reversed', 'retired'
);

CREATE TABLE insight_lineage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id INTEGER NOT NULL,
  predecessor_id INTEGER,
  relationship TEXT NOT NULL,    -- 'confirms', 'strengthens', 'weakens', 'reverses', 'supersedes'
  confidence_delta REAL
);
```

### "What Changed" Reports

Every analysis run leads with changes, not static observations:
- **CONFIRMED**: Pattern still holds (Nth consecutive run)
- **REVERSED**: Previous insight no longer true — explain why
- **NEW SIGNAL**: Pattern emerging with early data
- **RETIRED**: Previous recommendation withdrawn with explanation

### Insight Stability Scoring

```
reliability = min(consecutive_appearances / 5, 1.0) * 0.4 + confidence_weight * 0.35 + stability_trend * 0.25
```

Insights that persist across 5+ runs are highly reliable. Insights that appeared once may be noise.

### Taxonomy Evolution

- **Auto-discovered** by Opus on first run (analyzes all posts, proposes 5-15 topic categories at right granularity)
- **Opus gets full context**: research findings, metric hierarchy, what we're optimizing for
- **Re-discovery triggers**: post count doubles, >20% of new posts unclassifiable, manual trigger
- New posts classified incrementally against existing taxonomy (Haiku, cheap)
- Taxonomy evolution preserves continuity — merge/split/rename, don't restart from scratch

### Feedback Integration

Store recommendation feedback (useful / not useful / acted on). Include feedback history in future LLM prompts:
- Don't repeat dismissed recommendation types
- Weight towards categories the user finds valuable
- Track which recommendations led to action and whether it worked

### Refresh Cadences

| Layer | Refreshes When | Model |
|-------|---------------|-------|
| Tags (new posts only) | After sync, if untagged posts exist | Haiku |
| Taxonomy | Manual trigger or post count doubles | Opus |
| Patterns + Recommendations | After sync, if 3+ new posts since last run | Sonnet + extended thinking |
| Overview summary | On dashboard load, from cached analysis | Haiku (narrate cached results) |

---

## Part 5: Observability & Debugging

### ai_logs Table

Every LLM call gets logged with full inputs and outputs:

```sql
CREATE TABLE ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  step TEXT NOT NULL,             -- 'taxonomy', 'tagging', 'pattern_detection', 'verification', 'recommendations'
  model TEXT NOT NULL,
  input_messages TEXT NOT NULL,   -- Full prompt/messages JSON
  output_text TEXT NOT NULL,      -- Full response
  tool_calls TEXT,               -- JSON array of tool calls and results
  input_tokens INTEGER,
  output_tokens INTEGER,
  thinking_tokens INTEGER,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

This lets you:
- See exactly what SQL queries the agent ran
- See the reasoning chain that led to each recommendation
- Compare outputs across model versions or prompt iterations
- Debug why a specific recommendation was generated
- Re-run Stage 3 (synthesis) with different prompts without re-running analysis

### Three-Stage Storage

Stage 1 (exploration) and Stage 2 (verification) outputs stored separately from Stage 3 (user-facing). You can inspect the analytical reasoning without it cluttering the dashboard.

---

## Part 6: Implementation Architecture

### Server Module Structure

```
server/src/
  ai/
    client.ts          -- OpenRouter client setup
    tools.ts           -- SQL query tool, submit_analysis tool definitions
    prompts.ts         -- System prompts for each stage
    tagger.ts          -- Post classification (Haiku)
    taxonomy.ts        -- Taxonomy discovery (Opus)
    analyzer.ts        -- Pattern detection + verification (Sonnet)
    recommender.ts     -- Recommendation generation with self-consistency
    orchestrator.ts    -- Coordinates the full pipeline
    cache.ts           -- Staleness checks, cache management
  db/
    ai-schema.sql      -- New tables (ai_tags, insights, ai_logs, etc.)
    ai-queries.ts      -- Query functions for AI tables
```

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/insights` | Latest cached analysis (patterns + recommendations) |
| GET | `/api/insights/changelog` | What changed since last run |
| POST | `/api/insights/refresh` | Trigger fresh analysis |
| GET | `/api/insights/tags` | AI tags for all posts (for dashboard filtering) |
| GET | `/api/insights/taxonomy` | Current content taxonomy |
| PATCH | `/api/insights/recommendations/:id/feedback` | Record feedback |
| GET | `/api/insights/logs/:runId` | Full AI logs for a run (debugging) |

### LLM Provider

OpenRouter via `TRUSTMIND_LLM_API_KEY` (OpenRouter key from trustmind project). Uses the Anthropic-compatible endpoint so we can use `@anthropic-ai/sdk` directly — if we ever want to switch to direct Anthropic API, just change the `baseURL`.

### Database

All new tables in the existing SQLite database. Read-only connection for the SQL tool (safety net — even if LLM crafts a write query, it fails).

---

## Sources

### Agentic Analysis
- Claude Agent SDK docs (overview, agent loop, custom tools, structured outputs)
- OpenRouter: Anthropic Agent SDK integration guide
- NVIDIA: Build an LLM-Powered Data Agent

### Prompting & Reasoning
- Wei et al., Chain-of-Thought Prompting (2022)
- Anthropic Prompting Best Practices & Extended Thinking docs
- Analysis of Competing Hypotheses (intelligence community framework)
- Improving Causal Reasoning in LLMs survey (2024)
- Causal Prompting: Debiasing via Front-Door Adjustment

### Self-Critique & Multi-Agent Evidence
- Huang et al., "LLMs Cannot Self-Correct Reasoning Yet" (ICLR 2024)
- Kamoi et al., "When Can LLMs Actually Correct Their Own Mistakes?" (TACL 2024)
- Madaan et al., "Self-Refine" (NeurIPS 2023)
- Gou et al., "CRITIC: Tool-Interactive Critiquing" (2023)
- Smit et al., "Should We Be Going MAD?" (ICML 2024)
- Wang et al., "Budget-Aware Evaluation" (EMNLP 2024)
- MAST: Multi-Agent System Failure Taxonomy (2025)

### Uncertainty & Calibration
- "Can LLMs Express Their Uncertainty?" (Xiong et al., ICLR 2024)
- "Do LLMs Estimate Uncertainty Well?" (ICLR 2025)
- Sample Size Effects on LLM Prompt Testing

### Evolving Systems
- Incremental Machine Learning patterns
- LangMem: Long-term Memory in LLM Applications
- BERTopic: Online Topic Modeling
- Bayesian Updating for small-sample analytics
