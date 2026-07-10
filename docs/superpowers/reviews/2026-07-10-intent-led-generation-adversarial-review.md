# Intent-Led Generation Adversarial Review

**Date:** 2026-07-10
**Policy:** TrustMind `adversarial-review`
**Tier:** full architecture review
**Final verdict:** approve

## Scope

- `docs/superpowers/specs/2026-07-10-intent-led-generation-design.md`
- `docs/superpowers/plans/2026-07-10-intent-led-generation.md`

The original eight-PR compatibility plan had already passed two review rounds. After it was reduced to a three-PR direct cutover, the architecture was reviewed again rather than carrying the earlier approval forward.

## Direct-Cutover Round 1

The isolated critic returned two blockers and one advisory.

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| D1 | BLOCKING | PR 2 activated intent-owned initial drafting while selected-draft revision and ghostwriter still reconstructed the old story/brainstorm authority. | accepted |
| D2 | BLOCKING | Direct Perplexity search required `PERPLEXITY_API_KEY`, but the existing configurable-key surface did not expose it. | accepted |
| D3 | ADVISORY | Generation-to-run correlation alone would still leave incomplete provider inputs in logs. | accepted |

### D1 Resolution

PR 2 is now the atomic authority cutover for every model-writing path already active at that point:

- initial drafts use `WritingContext`,
- selected-draft revision uses `WritingContext`,
- ghostwriter uses `WritingContext`,
- an intermediate-head route test requires stored intent under `AUTHOR INTENT - CONTROLLING` in all three paths.

PR 3 adds only the new restart mode; it no longer repairs authority left behind by PR 2.

### D2 Resolution

PR 1 now adds `PERPLEXITY_API_KEY` to the existing `CONFIGURABLE_KEYS` record, its existing settings-route tests, and the environment documentation. It does not add a route, settings store, or UI subsystem.

### D3 Resolution

PR 3 retains the nullable `ai_runs.generation_id` correlation and adds focused tests requiring the existing `ai_logs.input_messages` field to contain the actual rendered context and provider input for initial draft, revision, and ghostwriter calls. No generalized telemetry or logging subsystem is introduced.

## Additional Surface Resolution

The parent review also found two old assumptions displaced by early intent ownership:

- active restore excluded generations without drafts,
- history labels depended on a selected story or brainstorm angle.

PR 2 now restores early intent-owned rows at step 1 and uses `author_intent` as the intent-only history label. Historical brainstorm fields remain read-only.

## Direct-Cutover Round 2

The same isolated critic re-read the updated design, plan, and affected code surfaces and returned `approve` with no findings.

## Convergence

- Original compatibility-plan review rounds: 2
- Direct-cutover review rounds: 2
- Direct-cutover blockers: 2 accepted, 0 rejected, 0 deferred
- Direct-cutover advisories: 1 accepted, 0 deferred
- Final unresolved findings: 0
- Human escalation: not required

The approval covers the architecture and implementation-plan handoff. Each PR still requires its named tests, intermediate-head authority gate, fresh-main validation, and scope review before merge.
