import { useState } from "react";
import { api, type GenDraft } from "../../api/client";
import type { SetGen } from "../Generate";
import DraftSidebar from "./components/DraftSidebar";
import DraftReader from "./components/DraftReader";
import ScannerLoader from "./components/ScannerLoader";

const REVISING_MESSAGES = [
  "Reading your feedback...",
  "Rethinking the approach...",
  "Rewriting drafts...",
  "Applying your direction...",
  "Polishing revisions...",
];

const COMBINING_MESSAGES = [
  "Analyzing draft structures...",
  "Identifying strongest hooks...",
  "Developing core themes...",
  "Removing AI tropes...",
  "Tightening the argument...",
  "Sharpening contrarian angles...",
  "Grounding in practitioner voice...",
  "Cutting filler and clichés...",
  "Strengthening the close...",
  "Crafting engagement hooks...",
  "Weaving personal connection...",
  "Polishing transitions...",
  "Checking word count...",
  "Optimizing for readability...",
  "Building the final draft...",
  "Eliminating passive voice...",
  "Adding specificity...",
  "Testing the opening line...",
  "Refining the takeaway...",
  "Final quality check...",
];

interface DraftVariationsProps {
  gen: {
    generationId: number | null;
    drafts: GenDraft[];
    selectedDraftIndices: number[];
    combiningGuidance: string;
  };
  setGen: SetGen;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function DraftVariations({ gen, setGen, loading, setLoading, onBack, onNext }: DraftVariationsProps) {
  const [activeDraft, setActiveDraft] = useState(0);
  const [reviseFeedback, setReviseFeedback] = useState(gen.combiningGuidance ?? "");
  const [loaderMessages, setLoaderMessages] = useState(COMBINING_MESSAGES);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = gen.selectedDraftIndices.length;

  const handleRevise = async () => {
    if (!reviseFeedback.trim()) return;
    if (gen.generationId === null) {
      setError("No active generation. Try starting a new draft.");
      return;
    }
    setError(null);
    setLoaderMessages(REVISING_MESSAGES);
    setLoading(true);
    try {
      const res = await api.reviseDrafts(gen.generationId, reviseFeedback.trim());
      setGen((prev) => ({
        ...prev,
        drafts: res.drafts,
        selectedDraftIndices: [],
      }));
      setReviseFeedback("");
    } catch (err: any) {
      console.error("Revise failed:", err);
      setError(err?.message ?? "Revision failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleInclude = (index: number) => {
    setGen((prev) => {
      const current = prev.selectedDraftIndices as number[];
      const next = current.includes(index)
        ? current.filter((i: number) => i !== index)
        : [...current, index];
      return { ...prev, selectedDraftIndices: next };
    });
  };

  const handleCombineAndReview = async () => {
    if (gen.generationId === null || selectedCount === 0) return;
    setLoading(true);
    try {
      // 1. Persist selection to DB
      await api.saveSelection(
        gen.generationId,
        gen.selectedDraftIndices,
        reviseFeedback || gen.combiningGuidance || undefined
      );

      // 2. Set sentinel final_draft so restore works even if AI asks before drafting
      const firstDraft = gen.drafts[gen.selectedDraftIndices[0]];
      if (firstDraft) {
        const sentinel = `${firstDraft.hook}\n\n${firstDraft.body}\n\n${firstDraft.closing}`;
        await api.saveDraft(gen.generationId, sentinel);
        setGen((prev) => ({
          ...prev,
          finalDraft: sentinel,
          originalDraft: sentinel,
          combiningGuidance: reviseFeedback || prev.combiningGuidance,
        }));
      }

      onNext();
    } catch (err) {
      console.error("Failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const actionLabel = selectedCount <= 1 ? "Review" : "Combine & review";

  if (loading) {
    return <ScannerLoader messages={loaderMessages} interval={2000} />;
  }

  return (
    <div>
      <div className="flex min-h-[60vh]">
        {/* Sidebar */}
        <DraftSidebar
          drafts={gen.drafts}
          activeDraft={activeDraft}
          selectedIndices={gen.selectedDraftIndices}
          onActivate={setActiveDraft}
          onToggleInclude={handleToggleInclude}
        />

        {/* Reading area */}
        {gen.drafts[activeDraft] && (
          <DraftReader draft={gen.drafts[activeDraft]} />
        )}
      </div>

      {/* Error feedback */}
      {error && (
        <div className="mt-4 px-1 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[14px] text-red-400">
          {error}
        </div>
      )}

      {/* Guidance — single input, two actions */}
      <div className="mt-4 px-1">
        <textarea
          value={reviseFeedback}
          onChange={(e) => {
            setReviseFeedback(e.target.value);
            setGen((prev) => ({ ...prev, combiningGuidance: e.target.value }));
          }}
          placeholder="Give direction — e.g. make them more opinionated, lead with the contrarian hook, shorter sentences..."
          className="w-full bg-gen-bg-2 border border-gen-border-2 rounded-lg px-4 py-3 text-[15px] text-gen-text-1 placeholder:text-gen-text-3 resize-none h-16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gen-accent/50 focus-visible:border-gen-accent-border"
        />
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={handleRevise}
            disabled={!reviseFeedback.trim()}
            className="px-4 py-2 border border-gen-border-2 text-gen-text-1 text-[14px] font-medium rounded-lg hover:bg-gen-bg-2 transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Revise all 3
          </button>
          {selectedCount >= 2 && (
            <button
              onClick={handleCombineAndReview}
              className="px-4 py-2 bg-gen-accent text-white text-[14px] font-medium rounded-lg hover:bg-gen-accent/90 transition-colors duration-150 ease-[var(--ease-snappy)]"
            >
              Use as merge guidance
            </button>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
        <button
          onClick={onBack}
          className="text-[15px] text-gen-text-2 hover:text-gen-text-0 transition-colors duration-150 ease-[var(--ease-snappy)]"
        >
          Back to stories
        </button>
        <div className="flex items-center gap-3">
          {selectedCount > 0 && (
            <span className="px-2.5 py-0.5 rounded-md text-[14px] font-bold bg-gen-accent-soft text-gen-accent border border-gen-accent-border">
              {selectedCount}
            </span>
          )}
          <button
            onClick={handleCombineAndReview}
            disabled={selectedCount === 0}
            className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[15px] font-medium rounded-[10px] hover:bg-white transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
