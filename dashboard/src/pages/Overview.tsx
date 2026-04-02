import { useState, useEffect } from "react";
import { api, type OverviewData, type AiOverview, type ScrapeError } from "../api/client";
import KPICard from "../components/KPICard";
import DateRangeSelector, {
  daysToDateRange,
} from "../components/DateRangeSelector";
import { useToast } from "../components/Toast";
import CoachChatPanel from "../components/CoachChatPanel";

function fmt(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toLocaleString();
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "--";
  return (n * 100).toFixed(1) + "%";
}

function pctChange(
  current: number | null | undefined,
  previous: number | null | undefined,
  rangeDays: number,
): string | null {
  if (rangeDays === 0) return null; // "All" — no meaningful comparison
  if (current == null || previous == null || previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}% vs prev ${rangeDays}d`;
}

export default function Overview() {
  const { showError } = useToast();
  const [range, setRange] = useState(30);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [prevOverview, setPrevOverview] = useState<OverviewData | null>(null);
  const [aiOverview, setAiOverview] = useState<AiOverview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncWarnings, setSyncWarnings] = useState<Array<{ message: string }>>([]);
  const [scrapeErrors, setScrapeErrors] = useState<ScrapeError[]>([]);
  const [coachChatOpen, setCoachChatOpen] = useState(false);

  useEffect(() => {
    api.getSyncHealth().then(r => setSyncWarnings(r.warnings)).catch(() => {});
    api.getScrapeHealth().then(r => setScrapeErrors(r.errors.filter(e => e.consecutive_count >= 3))).catch(() => {});
  }, []);

  useEffect(() => {
    const params = daysToDateRange(range);
    api.overview(params).then(setOverview).catch(() => showError("Failed to load overview data"));

    // Fetch previous period for comparison
    if (range > 0) {
      const until = new Date();
      until.setDate(until.getDate() - range);
      const since = new Date();
      since.setDate(since.getDate() - range * 2);
      api
        .overview({ since: since.toISOString(), until: until.toISOString() })
        .then(setPrevOverview)
        .catch(() => showError("Failed to load comparison data"));
    } else {
      setPrevOverview(null);
    }

    api
      .insightsOverview()
      .then((r) => setAiOverview(r.overview))
      .catch(() => showError("Failed to load AI insights"));
  }, [range]);

  const handleRefresh = () => {
    setRefreshing(true);
    api
      .insightsRefresh()
      .then(() => {
        // Pipeline runs async — poll for results every 5s for up to 3 minutes
        let attempts = 0;
        const poll = () => {
          attempts++;
          api
            .insightsOverview()
            .then((r) => {
              if (r.overview || attempts >= 36) {
                setAiOverview(r.overview);
                setRefreshing(false);
              } else {
                setTimeout(poll, 5000);
              }
            })
            .catch(() => setRefreshing(false));
        };
        setTimeout(poll, 5000);
      })
      .catch(() => setRefreshing(false));
  };

  let quickInsights: string[] = [];
  if (aiOverview?.quick_insights) {
    try {
      quickInsights = JSON.parse(aiOverview.quick_insights);
    } catch {
      /* ignore parse errors */
    }
  }

  return (
    <div className="space-y-5">
      {syncWarnings.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-sm text-yellow-200">
          <span className="font-medium">Sync issue detected:</span>{" "}
          {syncWarnings[0].message}
        </div>
      )}
      {scrapeErrors.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
          <p className="text-amber-200 text-sm font-medium">Scraping Issues Detected</p>
          {scrapeErrors.map((e) => (
            <p key={`${e.error_type}-${e.page_type}`} className="text-amber-200/70 text-xs mt-1">
              {e.page_type} scraper failing since {new Date(e.first_seen_at).toLocaleDateString()}
              {e.consecutive_count > 1 && ` (${e.consecutive_count} consecutive failures)`}
            </p>
          ))}
          <p className="text-amber-200/50 text-xs mt-2 [text-wrap:pretty]">
            This usually means LinkedIn changed their page structure. The extension may need an update.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between animate-fade-up">
        <h2 className="text-xl font-semibold [text-wrap:balance]">Overview</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCoachChatOpen(true)}
            className="px-3 py-1.5 bg-accent/10 text-accent text-[14px] font-medium rounded-lg hover:bg-accent/20 transition-colors"
          >
            Chat with Coach
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh AI"}
          </button>
          <DateRangeSelector selected={range} onChange={setRange} />
        </div>
      </div>

      {/* AI Summary Card */}
      <div className="animate-fade-up" style={{ animationDelay: "60ms" }}>
        {aiOverview ? (
          <div className="bg-surface-1 border-l-2 border-l-accent border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium text-accent mb-2">AI Summary</h3>
            <p className="text-sm text-text-primary leading-relaxed [text-wrap:pretty]">
              {aiOverview.summary_text}
            </p>
          </div>
        ) : (
          <div className="bg-surface-1 border border-border rounded-lg p-8 text-center">
            <svg className="w-8 h-8 text-accent/40 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-sm font-medium text-text-secondary">AI insights not generated yet</p>
            <p className="text-xs text-text-muted mt-1 mb-3 [text-wrap:pretty]">Click below to analyze your posts and generate personalized insights.</p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-4 py-2 rounded-md text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-50"
            >
              {refreshing ? "Generating..." : "Generate Insights"}
            </button>
          </div>
        )}
      </div>

      {/* KPI Cards with % change */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-up" style={{ animationDelay: "120ms" }}>
        <KPICard
          label="Impressions"
          value={fmt(overview?.total_impressions)}
          subtitle={pctChange(
            overview?.total_impressions,
            prevOverview?.total_impressions,
            range,
          )}
          variant="hero"
        />
        <KPICard
          label="Avg Engagement"
          value={fmtPct(overview?.avg_engagement_rate)}
          subtitle={pctChange(
            overview?.avg_engagement_rate,
            prevOverview?.avg_engagement_rate,
            range,
          )}
        />
        <KPICard
          label="Followers"
          value={fmt(overview?.total_followers)}
          subtitle={pctChange(
            overview?.total_followers,
            prevOverview?.total_followers,
            range,
          )}
        />
        <KPICard
          label="Profile Views"
          value={fmt(overview?.profile_views)}
          subtitle={pctChange(
            overview?.profile_views,
            prevOverview?.profile_views,
            range,
          )}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-8 animate-fade-up" style={{ animationDelay: "180ms" }}>
        {/* Top Performer Card */}
        {aiOverview?.top_performer_reason && (
          <div className="bg-positive/5 border border-positive/20 rounded-lg p-5">
            <h3 className="text-sm font-medium text-positive mb-2">
              Top Performer
            </h3>
            <p className="text-sm text-text-primary leading-relaxed [text-wrap:pretty]">
              {aiOverview.top_performer_reason}
            </p>
            {aiOverview.top_performer_post_id && (
              <a
                href={`https://www.linkedin.com/feed/update/urn:li:activity:${aiOverview.top_performer_post_id}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline mt-2 inline-block"
              >
                View post on LinkedIn
              </a>
            )}
          </div>
        )}

        {/* Quick Insights */}
        {quickInsights.length > 0 && (
          <div className="bg-surface-1 border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium text-text-secondary mb-3">
              Quick Insights
            </h3>
            <ul className="space-y-2">
              {quickInsights.map((insight, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-text-primary"
                >
                  <span className="text-accent mt-0.5 shrink-0">&#8226;</span>
                  <span className="[text-wrap:pretty]">{insight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <CoachChatPanel open={coachChatOpen} onClose={() => setCoachChatOpen(false)} />
    </div>
  );
}
