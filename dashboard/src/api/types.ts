import type {
  PromptSuggestion,
  PromptSuggestions,
  MetricsSummary,
  ProgressData,
  CategoryPerformance,
  SparklinePoint,
  EngagementQuality,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
  Story as GenStory,
  Draft as GenDraft,
  RetroChange,
  RetroRuleSuggestion,
  RetroPromptEdit,
  RetroAnalysis,
} from "@reachlab/shared";

export type {
  PromptSuggestion,
  PromptSuggestions,
  MetricsSummary,
  ProgressData,
  CategoryPerformance,
  SparklinePoint,
  EngagementQuality,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
  GenStory,
  GenDraft,
  RetroChange,
  RetroRuleSuggestion,
  RetroPromptEdit,
  RetroAnalysis,
};

export interface OverviewData {
  total_impressions: number;
  avg_engagement_rate: number | null;
  total_followers: number | null;
  profile_views: number | null;
  posts_count: number;
}

export interface Post {
  id: string;
  content_preview: string | null;
  hook_text: string | null;
  full_text: string | null;
  image_local_paths: string | null;
  content_type: string;
  published_at: string;
  url: string | null;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  sends: number | null;
  engagement_rate: number | null;
  weighted_engagement: number | null;
  post_category: string | null;
  topics: string | null;
}

export interface PostsResponse {
  posts: Post[];
  total: number;
  offset: number;
  limit: number;
}

export interface MetricSnapshot {
  id: number;
  post_id: string;
  scraped_at: string;
  impressions: number | null;
  members_reached: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  sends: number | null;
  video_views: number | null;
  watch_time_seconds: number | null;
  avg_watch_time_seconds: number | null;
}

export interface TimingSlot {
  day: number;
  hour: number;
  avg_engagement_rate: number | null;
  post_count: number;
}

export interface FollowerSnapshot {
  date: string;
  total_followers: number;
  new_followers: number | null;
}

export interface ProfileSnapshot {
  date: string;
  profile_views: number | null;
  search_appearances: number | null;
  all_appearances: number | null;
}

export interface AiOverview {
  summary_text: string;
  top_performer_post_id: string | null;
  top_performer_reason: string | null;
  quick_insights: string; // JSON array string
}

export interface Recommendation {
  id: number;
  type: string;
  priority: string;
  confidence: string;
  headline: string;
  detail: string;
  action: string;
  evidence_json: string | null;
  feedback: string | null;
  acted_on: number;
  created_at: string;
  resolved_at: string | null;
  resolved_type: string | null;
  stable_key: string | null;
}

export interface Insight {
  id: number;
  category: string;
  stable_key: string;
  claim: string;
  evidence: string;
  confidence: string;
  direction: string;
  consecutive_appearances: number;
  status: string;
}

export interface Changelog {
  confirmed: Insight[];
  new_signal: Insight[];
  reversed: Insight[];
  retired: Insight[];
}

export interface AnalysisGap {
  id: number;
  gap_type: string;
  stable_key: string;
  description: string;
  impact: string;
  times_flagged: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface WritingPromptHistory {
  id: number;
  prompt_text: string;
  source: string;
  suggestion_evidence: string | null;
  created_at: string;
}

export interface AiRun {
  id: number;
  triggered_by: string;
  post_count: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cost_cents: number | null;
}

export interface TaxonomyItem {
  id: number;
  name: string;
  description: string;
}

export interface RecommendationsWithCooldown {
  active: Recommendation[];
  resolved: Recommendation[];
}

export interface AnalysisStatus {
  running: { id: number; started_at: string } | null;
  last_run: { id: number; completed_at: string; triggered_by: string } | null;
  schedule: string;
  post_threshold: number;
  next_auto_regen: string | null;
}

export interface ScrapeError {
  error_type: string;
  page_type: string;
  selector: string | null;
  message: string;
  consecutive_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface HealthData {
  last_sync_at: string | null;
  sources: {
    posts: { status: "ok" | "error"; last_success: string | null; error?: string };
    followers: { status: "ok" | "error"; last_success: string | null; error?: string };
    profile: { status: "ok" | "error"; last_success: string | null; error?: string };
  };
  analysis?: {
    status: "ok" | "failing" | "no_runs";
    last_success: string | null;
    consecutive_failures: number;
    last_error?: string | null;
  };
}

// ── Generate Pipeline Types ─────────────────────────────────

export interface GenResearchResponse {
  research_id: number;
  stories: GenStory[];
  article_count: number;
  source_count: number;
}

export interface GenDraftsResponse {
  generation_id: number;
  drafts: GenDraft[];
}

export interface DiscoveryTopic {
  label: string;
  summary: string;
  source_headline: string;
  source_url: string;
  category_tag: string;
}

export interface DiscoveryResponse {
  topics: DiscoveryTopic[];
}

export interface GenExpertiseItem {
  area: string;
  question: string;
}

export interface GenAlignmentItem {
  dimension: string;
  summary: string;
}

export interface GenCoachCheckQuality {
  expertise_needed: GenExpertiseItem[];
  alignment: GenAlignmentItem[];
}

export interface GenChatResponse {
  draft: string;
  quality: GenCoachCheckQuality;
  explanation: string;
}

export interface GenChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  display_content: string;
  draft_snapshot?: string;
  quality_json?: string;
}

export interface GenCombineResponse {
  final_draft: string;
  quality: GenCoachCheckQuality;
}

export interface GhostwriteResponse {
  message: string;
  draft: string | null;
  change_summary: string | null;
  tools_used: string[];
}

export interface GenRule {
  id?: number;
  rule_text: string;
  example_text?: string | null;
  sort_order: number;
  origin?: string;
}

export interface GenRulesResponse {
  categories: {
    voice_tone: GenRule[];
    structure_formatting: GenRule[];
    anti_ai_tropes: { enabled: boolean; rules: GenRule[] };
  };
}

export interface GenHistoryItem {
  id: number;
  hook_excerpt: string;
  story_headline: string;
  drafts_used: number;
  post_type: string;
  status: string;
  created_at: string;
}

export interface GenHistoryResponse {
  generations: GenHistoryItem[];
  total: number;
}

export interface GenCoachingChange {
  id: number;
  type: "new" | "updated" | "retire";
  title: string;
  evidence: string;
  old_text?: string;
  new_text?: string;
  insight_id?: number;
}

export interface GenCoachingSyncResponse {
  sync_id: number;
  changes: GenCoachingChange[];
}

export interface GenCoachingInsight {
  id: number;
  title: string;
  prompt_text: string;
  evidence: string | null;
  status: string;
}

export interface AuthorProfileResponse {
  profile_text: string;
  profile_json: {
    mental_models: string[];
    contrarian_convictions: string[];
    scar_tissue: string[];
    disproportionate_caring: string[];
    vantage_point: string;
    persuasion_style: string;
  };
  interview_count: number;
}

export interface InterviewSessionResponse {
  client_secret: string;
  model: string;
}

export interface ExtractedProfileResponse {
  profile_text: string;
  profile_json: {
    mental_models: string[];
    contrarian_convictions: string[];
    scar_tissue: string[];
    disproportionate_caring: string[];
    vantage_point: string;
    persuasion_style: string;
  };
}

export interface RetroResponse {
  retro: {
    published_text: string;
    analysis: RetroAnalysis;
    retro_at: string;
  } | null;
}

export interface PendingRetro {
  generation_id: number;
  draft_excerpt: string;
  retro_at: string;
  matched_post_id: string | null;
  analysis: RetroAnalysis;
}

export interface GenSource {
  id: number;
  name: string;
  feed_url: string;
  enabled: number;
  created_at?: string;
}
