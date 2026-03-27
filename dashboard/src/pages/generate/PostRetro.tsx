import { useState, useEffect } from "react";
import { api, type RetroAnalysis, type RetroRuleSuggestion, type RetroPromptEdit } from "../../api/client";
import ScannerLoader from "./components/ScannerLoader";
import { useToast } from "../../components/Toast";

interface PostRetroProps {
  generationId: number;
  draftText: string;
  finalDraftText?: string;
  onBack: () => void;
}

export default function PostRetro({ generationId, draftText, finalDraftText, onBack }: PostRetroProps) {
  const { showError } = useToast();
  const [publishedText, setPublishedText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<RetroAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedRules, setAppliedRules] = useState<Set<number>>(new Set());
  const [appliedPromptEdits, setAppliedPromptEdits] = useState<Set<number>>(new Set());

  // Load existing retro (including ones completed while we were away)
  useEffect(() => {
    api.generateGetRetro(generationId).then((res) => {
      if (res.retro) {
        setPublishedText(res.retro.published_text);
        setAnalysis(res.retro.analysis);
      }
    }).catch(() => showError("Failed to load retro data"));
  }, [generationId]);

  const handleAnalyze = async () => {
    if (!publishedText.trim()) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setAppliedRules(new Set());
    setAppliedPromptEdits(new Set());
    try {
      const res = await api.generateRetro(generationId, publishedText);
      setAnalysis(res.analysis);
    } catch (err: any) {
      // Try to extract a useful message from the response
      let msg = "Analysis failed";
      try {
        if (err.message?.includes("502") || err.message?.includes("API error")) {
          msg = "AI service temporarily unavailable — try again in a moment";
        } else {
          msg = err.message || msg;
        }
      } catch { /* use default */ }
      setError(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAddRule = async (rule: RetroRuleSuggestion, index: number) => {
    try {
      await api.generateAddRule(rule.category, rule.rule_text);
      setAppliedRules((prev) => new Set(prev).add(index));
    } catch { /* ignore */ }
  };

  const handleApplyPromptEdit = async (edit: RetroPromptEdit, index: number) => {
    try {
      const res = await api.getWritingPrompt();
      const current = res.text ?? "";
      let updated: string;

      if (edit.type === "add") {
        if (current.includes(edit.add_text)) return;
        updated = current.trimEnd() + "\n\n" + edit.add_text;
      } else if (edit.type === "remove" && edit.remove_text) {
        if (!current.includes(edit.remove_text)) return;
        updated = current.replace(edit.remove_text, "").replace(/\n{3,}/g, "\n\n").trim();
      } else if (edit.type === "replace" && edit.remove_text) {
        if (!current.includes(edit.remove_text)) {
          updated = current.trimEnd() + "\n\n" + edit.add_text;
        } else {
          updated = current.replace(edit.remove_text, edit.add_text);
        }
      } else {
        return;
      }

      await api.saveWritingPrompt(updated, "ai_suggestion", edit.reason);
      await api.markRetroApplied(generationId);
      setAppliedPromptEdits((prev) => new Set(prev).add(index));
    } catch { /* ignore */ }
  };

  const significanceDot = (s: string) =>
    s === "high" ? "bg-accent" : "bg-text-muted";

  const categoryLabel = (c: string) => {
    const labels: Record<string, string> = {
      structural: "Structure", voice: "Voice", content: "Content",
      hook: "Hook", closing: "Closing", cut: "Cut", added: "Added",
    };
    return labels[c] ?? c;
  };

  const ruleCategoryLabel = (c: string) =>
    c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-[13px] text-text-secondary hover:text-text-primary">
          Back
        </button>
        <h2 className="text-[15px] font-semibold text-text-primary">Post Retro</h2>
      </div>

      {/* Side-by-side: original, revised (if changed), published */}
      <div className="relative">
        {analyzing && (
          <div className="absolute inset-0 bg-surface-0/70 z-10 rounded-xl flex items-center justify-center backdrop-blur-[1px]">
            <ScannerLoader
              messages={[
                "Comparing drafts...",
                "Identifying meaning changes...",
                "Extracting editorial principles...",
                "Generating prompt suggestions...",
              ]}
              interval={4000}
            />
          </div>
        )}
        <div className={analyzing ? "opacity-30 pointer-events-none" : ""}>
          {(() => {
            const hasRevisions = finalDraftText && finalDraftText !== draftText;
            const cols = hasRevisions ? "grid-cols-3" : "grid-cols-2";
            return (
              <div className={`grid ${cols} gap-4`}>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-text-muted font-medium mb-2">
                    {hasRevisions ? "Original AI Draft" : "AI Draft"}
                  </label>
                  <div className="bg-surface-2 rounded-lg p-4 text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                    {draftText}
                  </div>
                </div>
                {hasRevisions && (
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-text-muted font-medium mb-2">
                      After Your Revisions
                    </label>
                    <div className="bg-surface-2 rounded-lg p-4 text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                      {finalDraftText}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-text-muted font-medium mb-2">
                    What You Published
                  </label>
                  <textarea
                    value={publishedText}
                    onChange={(e) => setPublishedText(e.target.value)}
                    placeholder="Paste the final version you published on LinkedIn..."
                    className="w-full bg-surface-2 border border-border rounded-lg p-4 text-[13px] text-text-primary leading-relaxed resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    rows={16}
                    disabled={analyzing}
                  />
                </div>
              </div>
            );
          })()}

          {/* Analyze button */}
          {!analysis && !analyzing && (
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={handleAnalyze}
                disabled={!publishedText.trim()}
                className="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent text-white hover:bg-accent/90 transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-50"
              >
                Analyze Differences
              </button>
              {error && <span className="text-[12px] text-negative">{error}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {analysis && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-surface-2 rounded-lg p-4 border border-border">
            <p className="text-[13px] text-text-primary leading-relaxed">{analysis.summary}</p>
            {analysis.surface_changes_summary && analysis.surface_changes_summary !== "None significant" && (
              <p className="text-[11px] text-text-muted mt-2">
                Surface changes: {analysis.surface_changes_summary}
              </p>
            )}
          </div>

          {/* Editorial principles */}
          {analysis.changes.length > 0 && (
            <div>
              <h3 className="text-[12px] uppercase tracking-wider text-text-muted font-medium mb-3">
                Editorial Principles
              </h3>
              <div className="space-y-3">
                {analysis.changes.map((change, i) => (
                  <div key={i} className="bg-surface-2 rounded-lg p-4 border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full ${significanceDot(change.significance)}`} />
                      <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                        {categoryLabel(change.category)}
                      </span>
                    </div>
                    <p className="text-[13px] text-text-primary leading-relaxed">{change.principle}</p>
                    {(change.draft_excerpt || change.published_excerpt) && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        {change.draft_excerpt && (
                          <div className="text-[12px]">
                            <span className="text-text-muted">Draft: </span>
                            <span className="text-negative/80 line-through">{change.draft_excerpt}</span>
                          </div>
                        )}
                        {change.published_excerpt && (
                          <div className="text-[12px]">
                            <span className="text-text-muted">Published: </span>
                            <span className="text-positive/80">{change.published_excerpt}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Patterns */}
          {analysis.patterns.length > 0 && (
            <div>
              <h3 className="text-[12px] uppercase tracking-wider text-text-muted font-medium mb-3">
                Patterns
              </h3>
              <ul className="space-y-2">
                {analysis.patterns.map((p, i) => (
                  <li key={i} className="text-[13px] text-text-secondary leading-relaxed pl-4 border-l-2 border-accent/30">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rule suggestions — with Apply buttons */}
          {analysis.rule_suggestions.length > 0 && (
            <div>
              <h3 className="text-[12px] uppercase tracking-wider text-text-muted font-medium mb-3">
                Suggested Rules
              </h3>
              <div className="space-y-3">
                {analysis.rule_suggestions.map((rule, i) => {
                  const applied = appliedRules.has(i);
                  return (
                    <div key={i} className="bg-surface-2 rounded-lg p-4 border border-border">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <span className="text-[11px] font-medium text-accent uppercase">
                            {rule.action} · {ruleCategoryLabel(rule.category)}
                          </span>
                          <p className="text-[13px] text-text-primary mt-1">{rule.rule_text}</p>
                          <p className="text-[11px] text-text-muted mt-1">{rule.evidence}</p>
                        </div>
                        <button
                          onClick={() => handleAddRule(rule, i)}
                          disabled={applied}
                          className={`shrink-0 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors duration-150 ease-[var(--ease-snappy)] ${
                            applied
                              ? "bg-positive/10 text-positive border border-positive/20"
                              : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                          }`}
                        >
                          {applied ? "Added" : "Add Rule"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Prompt edits — with preview and Apply buttons */}
          {analysis.prompt_edits && analysis.prompt_edits.length > 0 && (
            <div>
              <h3 className="text-[12px] uppercase tracking-wider text-text-muted font-medium mb-3">
                Writing Prompt Updates
              </h3>
              <div className="space-y-3">
                {analysis.prompt_edits.map((edit, i) => {
                  const applied = appliedPromptEdits.has(i);
                  return (
                    <div key={i} className="bg-surface-2 rounded-lg p-4 border border-border">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <p className="text-[11px] text-text-muted">{edit.reason}</p>
                          {edit.remove_text && (
                            <div className="bg-negative/5 border border-negative/15 rounded-md p-3">
                              <span className="text-[10px] uppercase tracking-wider text-negative/70 font-medium">Remove</span>
                              <p className="text-[12px] text-negative/80 mt-1 line-through">{edit.remove_text}</p>
                            </div>
                          )}
                          <div className="bg-positive/5 border border-positive/15 rounded-md p-3">
                            <span className="text-[10px] uppercase tracking-wider text-positive/70 font-medium">
                              {edit.type === "add" ? "Add" : "Replace with"}
                            </span>
                            <p className="text-[12px] text-positive/80 mt-1">{edit.add_text}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleApplyPromptEdit(edit, i)}
                          disabled={applied}
                          className={`shrink-0 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors duration-150 ease-[var(--ease-snappy)] ${
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
            </div>
          )}

          {/* Re-analyze */}
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !publishedText.trim()}
            className="text-[12px] text-text-muted hover:text-accent transition-colors duration-150 ease-[var(--ease-snappy)]"
          >
            Re-analyze
          </button>
        </div>
      )}
    </div>
  );
}
