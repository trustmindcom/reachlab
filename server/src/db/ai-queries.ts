import type {
  PromptSuggestion,
  PromptSuggestions,
  MetricsSummary,
  CategoryPerformance,
  SparklinePoint,
  EngagementQuality,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
} from "@reachlab/shared";

export type {
  PromptSuggestion,
  PromptSuggestions,
  MetricsSummary,
  CategoryPerformance,
  SparklinePoint,
  EngagementQuality,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
};

// ── Re-exports: runs ──────────────────────────────────────
export { createRun, completeRun, failRun, getRunningRun, getRunCost, getLatestCompletedRun, getRunLogs, insertAiLog, getAiLogsForRun, listCompletedRuns, getTotalCostForPersona, getLastFullRun, getRunsNeedingCostBackfill, backfillRunCost, pruneOldAiLogs } from "./ai/runs.js";
export type { AiLogInput } from "./ai/runs.js";

// ── Re-exports: tags ──────────────────────────────────────
export { upsertAiTag, getAiTags, getUntaggedPostIds, upsertImageTag, getImageTags, getUnclassifiedImagePosts, upsertTaxonomy, getTaxonomy, setPostTopics, getPostTopics, clearTagsForPersona } from "./ai/tags.js";
export type { AiTag, ImageTagInput, ImageTag } from "./ai/tags.js";

// ── Re-exports: insights ──────────────────────────────────
export { insertInsight, getActiveInsights, retireInsight, insertInsightLineage, upsertOverview, getLatestOverview, getChangelog, getLatestAnalysisGaps, upsertAnalysisGap, getLatestPromptSuggestions, clearPromptSuggestions } from "./ai/insights.js";
export type { InsightInput, OverviewInput, AnalysisGapInput, AnalysisGapRow } from "./ai/insights.js";

// ── Re-exports: recommendations ───────────────────────────
export { insertRecommendation, getUnresolvedRecommendationHeadlines, getRecommendations, getRecommendationsWithCooldown, updateRecommendationFeedback, resolveRecommendation, getRecommendationById, markRecommendationActedOn, getRecentFeedbackWithReasons } from "./ai/recommendations.js";
export type { RecommendationInput } from "./ai/recommendations.js";

// ── Re-exports: deep-dive ─────────────────────────────────
export { getProgressMetrics, getCategoryPerformance, getEngagementQuality, getSparklineData, getTopicPerformance, getHookPerformance, getImageSubtypePerformance, getPostCountWithMetrics, getPostCountSinceRun } from "./ai/deep-dive.js";

// ── Re-exports: settings ──────────────────────────────────
export { getSetting, upsertSetting, deleteSetting, saveWritingPromptHistory, getWritingPromptHistory } from "./ai/settings.js";
export type { WritingPromptHistoryRow } from "./ai/settings.js";
