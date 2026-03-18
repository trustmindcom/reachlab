-- Seed a default writing prompt for new users so they have something to start with.
-- Only inserts if no writing_prompt setting exists yet.
INSERT OR IGNORE INTO settings (key, value)
VALUES ('writing_prompt', 'Look into the news of the day in my industry, prioritizing stories where I can make a specific non-obvious claim from my own experience. For each story you identify, state: (1) what the obvious take is, (2) what my sharper or more specific practitioner take could be, and (3) whether it connects to something I have personally built, shipped, researched, witnessed, or gotten wrong. Stories where I can add a perspective only a practitioner would have should be ranked above stories where I am commenting as an informed observer.

Find three interesting stories that match the patterns in my best LinkedIn posts: a sharp non-obvious thesis, clear practitioner authority, one idea per post, and a point of view that invites informed disagreement from other professionals in my field. For each story, briefly explain why it matches those patterns and what specific debate or question it is likely to trigger in comments.

For each story, brainstorm 2-3 ways it connects to something I have personally built, shipped, witnessed, or gotten wrong. Then write three LinkedIn-ready drafts with three distinct structures: one contrarian thesis post, one operator lesson from direct practice, and one future-facing implication for leaders in my field. Each draft should open with a hook that could stand alone as a reason to keep reading and close with a specific question designed to trigger a substantive response from practitioners.

Style guidelines:
- Each post should be approximately 120-220 words. Optimize for one strong hook, one clear argument, and one strong ending rather than a fixed word count.
- If a post naturally resolves in 90 sharp words, keep it short. If it needs more to land the point, let it run slightly longer.
- Minimal em dashes. Prefer periods and line breaks for pacing.
- If a post has a strong opening and a strong ending but the middle is just supporting evidence, cut the middle. The hook and the takeaway matter more than the proof. Trust the reader to follow the logic.
- One idea per post. If a draft has two interesting ideas, split it into two posts.
- The personal angle does not need to dominate the post but should anchor the opening or the closing.');
