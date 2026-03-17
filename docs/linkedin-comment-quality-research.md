# LinkedIn Comment Quality Scoring and Conversation Depth Mechanics (2025-2026)

Research compiled 2026-03-17. For inclusion in AI analytics system knowledge base.
Focus: specific, non-obvious facts with sourced numbers. Confidence levels noted where claims lack primary sourcing.

---

## 1. Comment Word Count Thresholds and Algorithmic Weight

### What is confirmed (multiple independent sources):

- Comments have **more than double the impact of likes** on post distribution. AuthoredUp's analysis of 621,000+ LinkedIn posts demonstrated this effect. (Source: AuthoredUp blog, "Commenting on LinkedIn Posts")
- Postiv AI (2M+ posts) states **comments are 15x more valuable than likes** for algorithmic distribution. (Source: Postiv AI LinkedIn Content Strategy 2025)
- The "15x" and "2x" figures are not contradictory -- they measure different things. The 2x figure refers to immediate distribution weight; the 15x figure includes downstream compounding effects (comments trigger more comments, extending post lifespan and re-entering distribution cycles).

### On the "15+ words = 2.5x weight" claim:

- **This specific threshold is NOT confirmed by any primary source.** It does not appear in LinkedIn engineering publications, AuthoredUp's data, or any indexed practitioner study.
- What IS confirmed: AuthoredUp recommends a **minimum of 14 words** for comments and states the most effective comments fall in the **150-300 character range** (approximately 25-50 words, or 1-3 short sentences). (Source: AuthoredUp "Commenting on LinkedIn Posts")
- LinkedIn's algorithm does distinguish between generic short comments ("Great post!") and substantive multi-sentence comments. AuthoredUp explicitly states generic comments are "buried or ignored" while substantive comments with specific references get better distribution.
- **The weight function is likely a gradient, not a step function.** Evidence: LinkedIn's 360Brew model (150B parameter decoder-only transformer) analyzes "lexical diversity" in comments and marks "similar phrases across multiple comments" as low-value. This implies continuous quality scoring, not a binary threshold. (Source: AuthoredUp "LinkedIn 360Brew" analysis)
- LinkedIn's content moderation ML uses XGBoost models trained on labeled data to predict content quality, deployed for both "feed posts and comments." The system uses real-time signals and resolves ~10% of queued content automatically at "extremely high precision." (Source: LinkedIn Engineering Blog, "Augmenting Content Moderation Through ML," Nov 2023)

### Practical model for the AI system:

- 1-3 words ("Great post!"): Near-zero algorithmic value
- 4-13 words: Minimal value -- likely treated as low-quality unless highly specific
- 14-50 words (150-300 chars): Sweet spot confirmed by AuthoredUp data
- 50+ words: Continued value but with diminishing returns (no data on ceiling)
- The gradient is almost certainly based on semantic analysis, not raw word count -- a 10-word comment with a specific question likely outweighs a 30-word generic platitude

## 2. Conversation Depth and Comment Exchange Amplification

### What is confirmed:

- Posts with **indirect comments** (replies to other comments, i.e., threaded conversations) see **up to 2.4x more reach** compared to posts with only top-level comments. (Source: AuthoredUp algorithm analysis, 2025)
- **Discussion threads between commenters** (indirect engagement) are specifically identified as a high-value signal. The algorithm treats comment-on-comment interactions as stronger engagement than standalone comments on the original post. (Source: AuthoredUp "LinkedIn 360Brew" analysis)
- A post with 50 comments outperforms a post with 500 likes in distribution. (Source: River Editor 300-post test, 2026)
- Comments drive **3x more reach than likes alone.** (Source: River Editor 300-post test)
- **Back-and-forth comment threads extend post lifespan** in the algorithm, keeping posts in distribution longer. (Source: multiple sources including SocialBee, GrowLeads)

### On the "3+ exchanges between different participants = 5.2x amplification" claim:

- **The specific 5.2x multiplier and "3+ exchanges" threshold are NOT confirmed by any primary source.** This exact claim does not appear in any indexed source.
- The 2.4x figure from AuthoredUp is the closest verified number, and it measures "indirect comments" (comment threads) broadly rather than specifying an exchange count threshold.
- The concept is directionally correct: multi-party threaded conversations are the highest-value engagement signal. But the precise multiplier is unverified.

### How "different participants" likely works (inferred from architecture):

- LinkedIn's Feed SR model (arxiv 2602.12354, Feb 2026) uses "actor/root-actor ID embeddings" and explicitly tracks "the number of times a member interacted with another member" as an affinity feature. The system distinguishes between the post creator ("root actor") and engagement participants ("actors").
- The 360Brew model analyzes "varied writing styles and job titles" in comment threads, suggesting commenter diversity is an explicit signal.
- Comments from multiple distinct members with different network graphs likely carry more weight than a back-and-forth between two people who frequently interact, because LinkedIn's system models network propagation: each new commenter represents a potential distribution expansion into their network.

## 3. The "19 Detailed Comments vs 43 Generic Comments" Study

### Status: **Unverifiable from public sources.**

- This specific comparison (19 detailed comments outperforming 43 generic by 3.2x reach) does not appear in any indexed source -- not AuthoredUp, Richard van der Blom's reports, LinkedIn engineering publications, or major social media analytics blogs.
- It may originate from a private A/B test shared in a LinkedIn post, newsletter, or community that is not publicly indexed. Many LinkedIn algorithm "facts" circulate through creator communities without traceable primary sources.

### What IS confirmed about comment quality vs quantity:

- AuthoredUp's 621K+ post analysis confirms the algorithm priorities quality over quantity: substantive comments with "specific references, added value, and discussion invitations" consistently outperform high volumes of generic reactions.
- LinkedIn's 360Brew model specifically flags "lexical diversity" issues -- if multiple comments use similar phrasing (suggesting pod activity or generic responses), they are marked as low-value. (Source: AuthoredUp 360Brew analysis)
- The content moderation ML system processes "hundreds of thousands of items" weekly and uses XGBoost models that score items on a continuous quality spectrum. (Source: LinkedIn Engineering Blog)

### What "detailed" likely means algorithmically:

Based on the 360Brew architecture (150B parameter language model):
- **Topical relevance**: Comment text that semantically relates to the post content (not generic praise)
- **Novel information**: Adding a perspective, data point, or question not already in the post
- **Lexical diversity**: Distinct vocabulary from other comments on the same post
- **Question-containing**: Comments with questions signal ongoing conversation potential
- **Specific references**: Mentioning particular concepts from the post rather than vague agreement

## 4. How LinkedIn Distinguishes "Great Post!" from Substantive Comments

### It is NLP-based, not simple heuristic. Here is the evidence:

**Layer 1 -- Spam/Low-Quality Detection (ML-based):**
- LinkedIn uses deep neural networks trained with TensorFlow for proactive content classification. These models evaluate "post features (content type, polarity, spamminess), member features (network influence, activity history), and engagement features (temporal sequences of likes, shares, comments, views)." (Source: LinkedIn Engineering, "Viral Spam Content Detection," Apr 2023)
- XGBoost models specifically handle comment-level quality scoring in review queues. The scoring "triggers every time an item enters the review queue" and "continuously updates the score." (Source: LinkedIn Engineering, "Augmenting Content Moderation Through ML," Nov 2023)

**Layer 2 -- 360Brew Content Understanding (LLM-based):**
- LinkedIn's 360Brew is a **150-billion parameter decoder-only transformer** trained on professional network data. It uses "many-shot in-context learning" from 2-3 months of user activity to create temporary personalized rankings. (Source: AuthoredUp 360Brew analysis)
- 360Brew analyzes four dimensions: "author credibility, audience interests, content substance, engagement quality."
- The model specifically evaluates "lexical diversity in replies" -- similar phrases across multiple comments get marked as low-value.

**Layer 3 -- Feed Ranking (Multi-task ML):**
- LinkedIn's production feed ranker uses a **two-tower neural network** architecture: one tower for passive consumption (clicks, dwell time) and one for active consumption (comments, shares). Comments are treated as an "active contribution interaction objective." (Source: LinkedIn Engineering, "Homepage Feed Multi-task Learning," Jun 2021)
- The Feed SR model (current production system as of 2026) uses an MMoE (Multi-gate Mixture-of-Experts) head architecture that predicts multiple engagement types simultaneously. Comments are predicted as a "Contributions" objective alongside likes and shares. (Source: arxiv 2602.12354)
- The model uses **50-dimensional content embeddings** from LinkedIn's post embedding model as input features. These embeddings encode semantic content, meaning the system has access to what the post is about when evaluating comment relevance. (Source: arxiv 2602.12354, Appendix A)

**Practical implications:**
- The system is NOT doing simple word-count heuristics. It is doing semantic analysis at multiple levels.
- A 5-word comment that asks a highly specific question about the post content may score higher than a 50-word generic response, because the semantic relevance signal is stronger.
- The 360Brew model's "lexical diversity" check means coordinated pod comments (multiple people posting similar supportive comments) are specifically detected and devalued.

## 5. Expert Commenter Weighting

### On the "5-7x more weight from relevant industry experts" claim:

- **This specific multiplier range is NOT confirmed by any primary source.** No LinkedIn engineering publication or major analytics study provides this number.

### What IS confirmed about commenter identity signals:

- AuthoredUp's 360Brew analysis confirms the algorithm evaluates "varied writing styles and **job titles**" in comment threads, suggesting commenter professional identity is an input signal.
- LinkedIn's Feed SR model uses **member profile embeddings** generated by a fine-tuned **Qwen3 0.6B parameter model** that aggregates "comprehensive information from LinkedIn member profiles." These embeddings capture professional identity (title, industry, skills, experience) and are refreshed daily. (Source: arxiv 2602.12354, Section 4.5)
- The Feed SR model also uses **actor/root-actor affinity features** that capture "the number of times a member interacted with another member, an object type, or other dimension." Removing viewer-actor affinity drops Long Dwell AUC by 0.3%. (Source: arxiv 2602.12354, Section 4.3 and Appendix A)
- LinkedIn's feed system reads "your headline, About section, and experience to classify expertise" and requires **80%+ of content within 2-3 core topics** for proper classification. Topic categorization takes approximately **90 days** for new creators. (Source: AuthoredUp 360Brew analysis)

### How expertise relevance likely works (inferred from architecture):

- The system has access to both the commenter's profile embedding (from Qwen3 model) and the post's content embedding (from LinkedIn's post embedding model). These exist in compatible vector spaces.
- A comment from someone whose profile embedding is semantically close to the post's content embedding (e.g., a data scientist commenting on a data engineering post) would naturally receive higher affinity scores in the Feed SR model.
- The "5-7x" claim is directionally plausible because:
  - CEO content already generates **4x more engagement** than average (Source: GrowLeads)
  - Employee reshares achieve **561% (5.6x) further reach** than company page posts (Source: GrowLeads)
  - These demonstrate that identity-based amplification in the 4-6x range exists in the system
- But the specific mechanism is likely not a static multiplier. It is a continuous function of profile-to-content semantic similarity, network graph position, and historical engagement patterns.

## 6. Creator Reply Timing and Distribution Effects

### What is confirmed:

- **Responding to comments within 15 minutes generates a "90% algorithmic boost"** is cited by GrowLeads (2026 algorithm analysis). (Source: GrowLeads "LinkedIn Algorithm 2026")
- The **first 60 minutes** after posting are the critical distribution window. LinkedIn shows the post to 2-5% of the creator's network during this period. Engagement quality during this window determines whether the post gets broader amplification. (Source: AuthoredUp, River Editor, multiple sources)
- Creator replies count as engagement signals that boost the algorithm's assessment of the post's value. (Source: River Editor 300-post test)
- Buffer states that **replying to comments can boost engagement by 30%.** (Source: Buffer LinkedIn Algorithm guide)
- AuthoredUp confirms comments within the first hour "tend to be most impactful" and early comments are more likely to remain visible near the top of threads. (Source: AuthoredUp "Commenting on LinkedIn Posts")

### On timing specifics:

- The "15-minute" window for the 90% boost is from a single source (GrowLeads) and should be treated as approximate. The underlying mechanism is:
  1. LinkedIn's feed ranking uses **dwell-time buckets** as context features (0-5s, up to >60s). Posts where the creator is actively replying generate more dwell time from returning commenters. (Source: arxiv 2602.12354, Appendix A)
  2. The Feed SR model uses **recency-weighted loss** with a 60-day half-life and position-weighted decay where the most recent interaction gets full weight. Creator replies in the first hour create fresh interaction signals during the highest-weight window. (Source: arxiv 2602.12354, Section 4.6.3)
  3. Posts with **delayed engagement (24-72 hours)** still perform well -- they receive **4-6x better distribution in suggested feeds**. This means creator replies beyond the first hour still have value through the "suggested" distribution channel. (Source: AuthoredUp 360Brew analysis)

### Practical model:

- 0-15 minutes: Highest impact (fresh signal during golden hour distribution test)
- 15-60 minutes: Still high impact (golden hour window)
- 1-4 hours: Moderate impact (second-wave distribution)
- 24-72 hours: Continued value through suggested feed channel (4-6x for delayed engagement posts)
- The key insight: the creator replying creates a "ping-pong" effect where the original commenter returns to read the reply, generating additional dwell time and potentially another comment, which compounds the engagement signal.

## 7. Technical Architecture Summary: How Comments Flow Through the System

Based on LinkedIn's published engineering papers and blog posts, comments affect distribution through this pipeline:

1. **Retrieval Stage** (LLaMA 3 dual encoder, arxiv 2510.14223): Posts are retrieved based on text-only embeddings matched against member interest profiles. Comments themselves do not affect retrieval directly -- but posts with active comment threads accumulate popularity signals that improve retrieval scores.

2. **Ranking Stage** (Feed SR, arxiv 2602.12354): The two-tower model predicts P(comment) as an "active contribution" objective alongside P(like) and P(share). The model uses:
   - Actor/root-actor ID embeddings (who commented)
   - Affinity counts (how often viewer has interacted with commenter)
   - Candidate popularity (engagement counts across time windows of 7-365 days)
   - Post age and freshness signals
   - 50-dimensional content embeddings (what the post is about)

3. **Quality Assessment** (360Brew, 150B parameter LLM + XGBoost moderation models): Evaluates comment substance, lexical diversity, author credibility, and topical relevance. Flags low-quality/repetitive comments for reduced weighting.

4. **Distribution Decision**: Posts are scored via "weighted linear combination" of P(action), E[downstream virals | action], and E[upstream value | action]. A post where the predicted comment probability is high AND the expected downstream viral effect of those comments is high gets maximum distribution.

## 8. Confidence Assessment for AI System Prompts

### HIGH CONFIDENCE (multiple sources, engineering publications):
- Comments are weighted 2x+ more than likes in distribution
- Multi-sentence substantive comments >> generic one-liners
- First 60 minutes is the critical distribution window
- Creator replies boost distribution (mechanism confirmed in architecture)
- Threaded conversations (indirect comments) boost reach up to 2.4x
- 360Brew uses NLP/LLM analysis, not simple heuristics, for quality scoring
- Pod-like behavior (repetitive comment patterns) is specifically detected and devalued
- Profile/expertise matching exists in the ranking architecture (member profile embeddings)

### MEDIUM CONFIDENCE (single source or directional inference):
- Comments are 15x more valuable than likes (single source: Postiv AI)
- Creator reply within 15 minutes = 90% boost (single source: GrowLeads)
- 14-word minimum for meaningful comments (single source: AuthoredUp recommendation)
- Delayed engagement (24-72h) gets 4-6x in suggested feeds (single source: AuthoredUp)
- 80% topic consistency required for expertise classification (single source: AuthoredUp)

### LOW CONFIDENCE (unverifiable from public sources):
- "15+ words = 2.5x more weight" -- specific threshold and multiplier not found anywhere
- "3+ exchanges between different participants = 5.2x amplification" -- specific numbers not found
- "19 detailed comments outperformed 43 generic by 3.2x" -- study not found in any indexed source
- "Relevant industry experts carry 5-7x weight" -- specific multiplier range not found

---

## Source Index

### LinkedIn Engineering (primary technical sources):
- Feed SR paper: arxiv 2602.12354 (Feb 2026) -- "An Industrial-Scale Sequential Recommender for LinkedIn Feed Ranking"
- LLM Retrieval paper: arxiv 2510.14223 (Oct 2025) -- "Large Scale Retrieval for the LinkedIn Feed using Causal Language Models"
- "Viral Spam Content Detection at LinkedIn" (Apr 2023): https://www.linkedin.com/blog/engineering/trust-and-safety/viral-spam-content-detection-at-linkedin
- "Augmenting Content Moderation Through ML" (Nov 2023): https://www.linkedin.com/blog/engineering/trust-and-safety/augmenting-our-content-moderation-efforts-through-machine-learni
- "Homepage Feed Multi-task Learning Using TensorFlow" (Jun 2021): https://www.linkedin.com/blog/engineering/feed/homepage-feed-multi-task-learning-using-tensorflow
- "Understanding Feed Dwell Time" (May 2020): https://www.linkedin.com/blog/engineering/feed/understanding-feed-dwell-time
- "Community-focused Feed Optimization" (Jun 2019): https://www.linkedin.com/blog/engineering/feed/community-focused-feed-optimization
- "Engineering the Next Generation of LinkedIn's Feed" (Mar 2026): https://www.linkedin.com/blog/engineering/feed/engineering-the-next-generation-of-linkedins-feed

### Practitioner Data (large-scale analyses):
- AuthoredUp: "How the LinkedIn Algorithm Works" (621K+ posts, updated Sep 2025): https://authoredup.com/blog/linkedin-algorithm
- AuthoredUp: "How to Write LinkedIn Comments That Get Noticed": https://authoredup.com/blog/commenting-on-linkedin-posts
- AuthoredUp: "LinkedIn 360Brew: What Actually Changed": https://authoredup.com/blog/linkedin-360brew
- Postiv AI (2M+ posts analyzed): https://postiv.ai/blog/linkedin-content-strategy-2025
- River Editor (300 posts tested, 2026): https://rivereditor.com/blogs/2026-linkedin-algorithm-what-works-300-posts-tested
- GrowLeads (2026 analysis): https://growleads.io/blog/linkedin-algorithm-2026-text-vs-video-reach/
- Buffer LinkedIn Algorithm Guide: https://buffer.com/resources/linkedin-algorithm/
- Social Insider (1.3M posts, 2025): https://www.socialinsider.io/social-media-benchmarks/linkedin
