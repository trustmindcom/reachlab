import { useState, useEffect } from "react";
import {
  api,
  type PromptSuggestion,
  type AnalysisStatus,
} from "../api/client";
import { formatTimeAgo, formatTimeUntil } from "./coach/components";
import { ActionsTab } from "./coach/ActionsTab";
import { InsightsTab } from "./coach/InsightsTab";
import { DeepDiveTab } from "./coach/DeepDiveTab";
import { useToast } from "../components/Toast";
import CoachChatPanel from "../components/CoachChatPanel";
import { useCoachActions } from "./coach/hooks/useCoachActions";
import { useCoachInsights } from "./coach/hooks/useCoachInsights";
import { useCoachDeepDive } from "./coach/hooks/useCoachDeepDive";

type CoachTab = "actions" | "insights" | "deep-dive";

export default function Coach() {
  const { showError } = useToast();
  const [coachChatOpen, setCoachChatOpen] = useState(false);
  const [tab, setTab] = useState<CoachTab>("actions");
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);

  const actions = useCoachActions(showError);
  const insights = useCoachInsights(showError);
  const deepDive = useCoachDeepDive(showError);

  const loadAll = () => {
    api.insightsStatus().then(setStatus).catch(() => showError("Failed to load analysis status"));
    actions.load();
    insights.load();
    deepDive.load();
  };

  useEffect(() => {
    loadAll();
    // If pipeline is running on load, poll until done
    api.insightsStatus().then((s) => {
      if (s.running) {
        setRefreshing(true);
        const poll = setInterval(() => {
          api.insightsStatus().then((s2) => {
            setStatus(s2);
            if (!s2.running) {
              clearInterval(poll);
              setRefreshing(false);
              loadAll();
            }
          }).catch(() => {});
        }, 3000);
      }
    }).catch(() => {});
  }, []);

  const handleRefresh = (force = false) => {
    setRefreshing(true);
    api.insightsRefresh(force)
      .then(() => {
        // Poll for completion
        const poll = setInterval(() => {
          api.insightsStatus().then((s) => {
            setStatus(s);
            if (!s.running) {
              clearInterval(poll);
              setRefreshing(false);
              loadAll();
            }
          }).catch(() => {});
        }, 3000);
      })
      .catch(() => setRefreshing(false));
  };

  const tabs: { key: CoachTab; label: string; count?: number }[] = [
    { key: "actions", label: "Overview", count: actions.activeRecs.length || undefined },
    { key: "insights", label: "Insights" },
    { key: "deep-dive", label: "Breakdowns" },
  ];

  return (
    <div className="space-y-5">
      {/* Header with tabs */}
      <div className="flex items-center border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-5 py-2.5 text-[15px] font-medium transition-colors duration-150 ease-[var(--ease-snappy)] ${
              tab === t.key
                ? "text-text-primary font-semibold"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[13px] font-semibold bg-accent/12 text-accent">
                {t.count}
              </span>
            )}
            {tab === t.key && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-accent rounded-t" />
            )}
          </button>
        ))}
        <div className="ml-auto py-2.5 flex items-center gap-3">
          {status && (
            <span className="text-[13px] text-text-muted">
              {status.running
                ? "Analyzing..."
                : status.last_run
                  ? `Last run ${formatTimeAgo(status.last_run.completed_at)}`
                  : "Never run"}
              {!status.running && status.next_auto_regen && (
                <> · Next auto-regen {formatTimeUntil(status.next_auto_regen)}</>
              )}
              {!status.running && status.schedule === "off" && (
                <> · Auto-regen off</>
              )}
            </span>
          )}
          <button
            onClick={() => setCoachChatOpen(true)}
            className="px-3 py-1.5 bg-accent/10 text-accent text-[14px] font-medium rounded-lg hover:bg-accent/20 transition-colors"
          >
            Chat with Coach
          </button>
          <button
            onClick={() => handleRefresh(true)}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-accent hover:bg-accent/8 transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-50"
          >
            {refreshing ? "Regenerating..." : "Regenerate"}
          </button>
        </div>
      </div>

      {/* Tab content */}
      {tab === "actions" && (
        <>
          {/* Post Retro — auto-detected prompt improvements */}
          {actions.pendingRetros.length > 0 && (
            <div className="mb-8">
              <h2 className="text-[15px] font-semibold text-text-primary uppercase tracking-wider mb-2">
                Post Retro
              </h2>
              <p className="text-[14px] text-text-muted mb-4">
                Based on changes you made between AI drafts and what you published
              </p>
              {actions.pendingRetros.map((retro) => (
                <div key={retro.generation_id} className="bg-surface-1 rounded-xl border border-border p-5 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[14px] text-text-muted">{formatTimeAgo(retro.retro_at)}</span>
                    <span className="text-[13px] text-text-muted">Draft #{retro.generation_id}</span>
                  </div>
                  <p className="text-[15px] text-text-primary mb-4 leading-relaxed">{retro.analysis.summary}</p>

                  {retro.analysis.prompt_edits && retro.analysis.prompt_edits.length > 0 && (
                    <div className="space-y-3">
                      <span className="text-[13px] uppercase tracking-wider text-text-muted font-medium">
                        Suggested prompt updates
                      </span>
                      {retro.analysis.prompt_edits.map((edit, i) => {
                        const key = `${retro.generation_id}-${i}`;
                        const applied = actions.appliedRetroEdits.has(key);
                        return (
                          <div key={i} className="bg-surface-2 rounded-lg p-4 border border-border">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <p className="text-[14px] text-text-muted mb-2">{edit.reason}</p>
                                {edit.remove_text && (
                                  <div className="text-[14px] bg-negative/5 text-negative/80 rounded px-2 py-1 mb-1 font-mono">
                                    − {edit.remove_text}
                                  </div>
                                )}
                                <div className="text-[14px] bg-positive/5 text-positive/80 rounded px-2 py-1 font-mono">
                                  + {edit.add_text}
                                </div>
                              </div>
                              <button
                                onClick={() => actions.handleApplyRetroEdit(retro.generation_id, i, edit)}
                                disabled={applied}
                                className={`shrink-0 px-3 py-1.5 rounded-md text-[14px] font-medium transition-colors duration-150 ease-[var(--ease-snappy)] ${
                                  applied
                                    ? "bg-positive/10 text-positive border border-positive/20"
                                    : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                                }`}
                              >
                                {applied ? "Applied" : "Apply"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <ActionsTab
            active={actions.activeRecs}
            resolved={actions.resolvedRecs}
            promptSuggestions={actions.promptSuggestions}
            onResolve={actions.handleResolve}
            onFeedback={actions.handleFeedback}
            onAcceptSuggestion={actions.handleAcceptSuggestion}
            progress={deepDive.progress}
            sparklinePoints={deepDive.sparklinePoints}
            insights={insights.insights}
          />
        </>
      )}
      {tab === "insights" && (
        <InsightsTab
          insights={insights.insights}
          changelog={insights.changelog}
          gaps={insights.gaps}
          timingSlots={insights.timingSlots}
        />
      )}
      {tab === "deep-dive" && (
        <DeepDiveTab
          categories={deepDive.categories}
          engagement={deepDive.engagement}
          sparklinePoints={deepDive.sparklinePoints}
          topics={deepDive.topics}
          hooks={deepDive.hooks}
          imageSubtypes={deepDive.imageSubtypes}
          timingSlots={insights.timingSlots}
        />
      )}
      <CoachChatPanel open={coachChatOpen} onClose={() => setCoachChatOpen(false)} />
    </div>
  );
}
