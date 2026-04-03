import { get, getUnscoped, withPersonaId } from "./helpers.js";
import type {
  OverviewData,
  PostsResponse,
  MetricSnapshot,
  TimingSlot,
  FollowerSnapshot,
  ProfileSnapshot,
  HealthData,
  AiOverview,
  Recommendation,
  Insight,
  Changelog,
  TaxonomyItem,
  RecommendationsWithCooldown,
  ProgressData,
  CategoryPerformance,
  EngagementQuality,
  SparklinePoint,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
  AnalysisGap,
  PromptSuggestions,
  AnalysisStatus,
  AiRun,
  ScrapeError,
} from "./types.js";

export const analyticsApi = {
  overview: (params?: { since?: string; until?: string }) => {
    const q = new URLSearchParams();
    if (params?.since) q.set("since", params.since);
    if (params?.until) q.set("until", params.until);
    const qs = q.toString();
    return get<OverviewData>(`/overview${qs ? `?${qs}` : ""}`);
  },
  posts: (params?: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) q.set(k, String(v));
      }
    }
    const qs = q.toString();
    return get<PostsResponse>(`/posts${qs ? `?${qs}` : ""}`);
  },
  metrics: (postId: string) =>
    get<{ post_id: string; metrics: MetricSnapshot[] }>(`/metrics/${postId}`),
  timing: () => get<{ slots: TimingSlot[] }>("/timing"),
  followers: () => get<{ snapshots: FollowerSnapshot[] }>("/followers"),
  profile: () => get<{ snapshots: ProfileSnapshot[] }>("/profile"),
  health: () => get<HealthData>("/health"),
  insightsOverview: () => getUnscoped<{ overview: AiOverview | null }>("/insights/overview"),
  insights: () => getUnscoped<{ recommendations: Recommendation[]; insights: Insight[] }>("/insights"),
  insightsChangelog: () => getUnscoped<Changelog>("/insights/changelog"),
  insightsTags: (postIds: string[]) =>
    getUnscoped<{ tags: Record<string, { hook_type: string; tone: string; format_style: string }> }>(
      `/insights/tags?post_ids=${postIds.join(",")}`
    ),
  insightsTaxonomy: () => getUnscoped<{ taxonomy: TaxonomyItem[] }>("/insights/taxonomy"),
  insightsRefresh: (force = false) =>
    fetch(withPersonaId(`/api/insights/refresh`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }).then((r) => r.json()),
  insightsStatus: () =>
    getUnscoped<AnalysisStatus>("/insights/status"),
  recommendationFeedback: (id: number, rating: string, reason?: string) =>
    fetch(withPersonaId(`/api/insights/recommendations/${id}/feedback`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: { rating, reason: reason || null } }),
    }).then((r) => r.json()),
  recommendationsWithCooldown: () =>
    getUnscoped<RecommendationsWithCooldown>("/insights/recommendations"),
  resolveRecommendation: (id: number, type: "accepted" | "dismissed") =>
    fetch(withPersonaId(`/api/insights/recommendations/${id}/resolve`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    }).then((r) => r.json()),

  // Deep Dive endpoints
  deepDiveProgress: (days = 30) =>
    getUnscoped<ProgressData>(`/insights/deep-dive/progress?days=${days}`),
  deepDiveCategories: () =>
    getUnscoped<{ categories: CategoryPerformance[] }>("/insights/deep-dive/categories"),
  deepDiveEngagement: () =>
    getUnscoped<{ engagement: EngagementQuality }>("/insights/deep-dive/engagement"),
  deepDiveSparkline: (days = 90) =>
    getUnscoped<{ points: SparklinePoint[] }>(`/insights/deep-dive/sparkline?days=${days}`),
  deepDiveTopics: (days?: number) =>
    getUnscoped<{ topics: TopicPerformance[] }>(`/insights/deep-dive/topics${days ? `?days=${days}` : ""}`),
  deepDiveHooks: (days?: number) =>
    getUnscoped<{ by_hook_type: HookPerformance[]; by_format_style: HookPerformance[] }>(
      `/insights/deep-dive/hooks${days ? `?days=${days}` : ""}`
    ),
  deepDiveImageSubtypes: (days?: number) =>
    getUnscoped<{ subtypes: ImageSubtypePerformance[] }>(
      `/insights/deep-dive/image-subtypes${days ? `?days=${days}` : ""}`
    ),

  // Analysis gaps
  insightsGaps: () =>
    getUnscoped<{ gaps: AnalysisGap[] }>("/insights/gaps"),

  // Prompt suggestions
  insightsPromptSuggestions: () =>
    getUnscoped<{ prompt_suggestions: PromptSuggestions | null }>("/insights/prompt-suggestions"),

  // Run history
  getAiRuns: () =>
    getUnscoped<{ runs: AiRun[]; total_cost_cents: number }>("/insights/runs"),

  // Scrape health
  getScrapeHealth: () => get<{ errors: ScrapeError[] }>("/scrape-health"),
};
