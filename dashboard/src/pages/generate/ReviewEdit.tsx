import { useState, useRef, useEffect } from "react";
import { api, type GenDraft, type GenQualityGate, type GenCoachingInsight, type GenStory } from "../../api/client";
import QualityGateCard from "./components/QualityGateCard";
import PostDetailsCard from "./components/PostDetailsCard";
import GuidanceAppliedCard from "./components/GuidanceAppliedCard";

interface ReviewEditProps {
  gen: {
    generationId: number | null;
    finalDraft: string;
    qualityGate: GenQualityGate | null;
    drafts: GenDraft[];
    selectedDraftIndices: number[];
    stories: GenStory[];
    selectedStoryIndex: number | null;
    appliedInsights: GenCoachingInsight[];
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onBack: () => void;
  onReset: () => void;
}

export default function ReviewEdit({ gen, setGen, loading, setLoading, onBack, onReset }: ReviewEditProps) {
  const [localDraft, setLocalDraft] = useState(gen.finalDraft);
  const [instruction, setInstruction] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync local draft when gen.finalDraft changes (from revisions)
  useEffect(() => {
    setLocalDraft(gen.finalDraft);
  }, [gen.finalDraft]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [localDraft]);

  const handleRevise = async (action: string, customInstruction?: string) => {
    if (!gen.generationId) return;
    setLoading(true);
    try {
      const res = await api.generateRevise(gen.generationId, action, customInstruction);
      setGen((prev: any) => ({
        ...prev,
        finalDraft: res.final_draft,
        qualityGate: res.quality_gate,
      }));
      setInstruction("");
    } catch (err) {
      console.error("Revise failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(localDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleOpenLinkedIn = async () => {
    await navigator.clipboard.writeText(localDraft);
    window.open("https://www.linkedin.com/feed/?shareActive=true", "_blank");
  };

  const wordCount = localDraft.split(/\s+/).filter(Boolean).length;
  const selectedDraftTypes = gen.selectedDraftIndices.map((i) => gen.drafts[i]?.type).filter(Boolean);
  const storyHeadline = gen.selectedStoryIndex !== null ? gen.stories[gen.selectedStoryIndex]?.headline || "" : "";
  const structureLabel = gen.drafts[gen.selectedDraftIndices[0]]?.structure_label || "";

  const quickActions = [
    { label: "Regenerate", action: "regenerate" },
    { label: "Shorten", action: "shorten" },
    { label: "Strengthen close", action: "strengthen_close" },
  ];

  return (
    <div>
      <div className="flex gap-6">
        {/* Editor panel */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={localDraft}
            onChange={(e) => setLocalDraft(e.target.value)}
            className="w-full bg-transparent text-[15.5px] leading-[1.85] text-gen-text-1 resize-none focus:outline-none min-h-[300px]"
            style={{ fontFamily: "var(--font-sans)" }}
          />

          {/* Quick action buttons */}
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gen-border-1">
            {quickActions.map((qa) => (
              <button
                key={qa.action}
                onClick={() => handleRevise(qa.action)}
                disabled={loading}
                className="px-3.5 py-1.5 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[13px] rounded-lg hover:border-gen-border-3 transition-colors disabled:opacity-50"
              >
                {qa.label}
              </button>
            ))}
            <span className="ml-auto text-[12px] text-gen-text-3">
              {wordCount} words
            </span>
          </div>

          {/* Free-text instruction */}
          <div className="flex gap-2 mt-3">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && instruction.trim()) {
                  handleRevise("custom", instruction.trim());
                }
              }}
              placeholder="Tell the AI what to change..."
              className="flex-1 bg-gen-bg-2 border border-gen-border-2 rounded-lg px-4 py-2.5 text-[13px] text-gen-text-1 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent-border"
            />
            <button
              onClick={() => {
                if (instruction.trim()) handleRevise("custom", instruction.trim());
              }}
              disabled={!instruction.trim() || loading}
              className="px-4 py-2.5 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[13px] rounded-lg hover:border-gen-border-3 transition-colors disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-[320px] flex-shrink-0 space-y-4">
          {gen.qualityGate && <QualityGateCard gate={gen.qualityGate} />}
          <PostDetailsCard
            storyHeadline={storyHeadline}
            draftsUsed={selectedDraftTypes}
            structureLabel={structureLabel}
            wordCount={wordCount}
          />
          <GuidanceAppliedCard insights={gen.appliedInsights} />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
        <button
          onClick={onBack}
          className="text-[13px] text-gen-text-2 hover:text-gen-text-0 transition-colors"
        >
          Back to drafts
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[13px] font-medium rounded-[10px] hover:border-gen-border-3 transition-colors"
          >
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <button
            onClick={handleOpenLinkedIn}
            className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors"
          >
            Open in LinkedIn
          </button>
        </div>
      </div>
    </div>
  );
}
