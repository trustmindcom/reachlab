import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import AgentChat, { type ChatMessage } from "../../components/AgentChat";

interface GhostwriterChatProps {
  gen: {
    generationId: number | null;
    finalDraft: string;
    chatMessages: ChatMessage[];
    combiningGuidance: string;
    originalDraft: string;
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onBack: () => void;
  onRetro?: () => void;
}

export default function GhostwriterChat({ gen, setGen, loading, setLoading, onBack, onRetro }: GhostwriterChatProps) {
  const [localDraft, setLocalDraft] = useState(gen.finalDraft);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draftHighlight, setDraftHighlight] = useState(false);

  const localDirtyRef = useRef(false);
  const serverDraftRef = useRef(gen.finalDraft);
  const startedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Debounced auto-save ──
  const cancelSaveTimer = () => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  const debouncedSave = useCallback((draft: string) => {
    cancelSaveTimer();
    saveTimerRef.current = setTimeout(() => {
      if (gen.generationId) {
        api.saveDraft(gen.generationId, draft).catch(() => {});
        localDirtyRef.current = false;
      }
    }, 1500);
  }, [gen.generationId]);

  // ── Sync local draft from AI updates (only when user hasn't made unsaved edits) ──
  useEffect(() => {
    serverDraftRef.current = gen.finalDraft;
    if (!localDirtyRef.current) {
      setLocalDraft(gen.finalDraft);
      setDraftHighlight(true);
      setTimeout(() => setDraftHighlight(false), 500);
    }
  }, [gen.finalDraft]);

  // ── Auto-resize draft textarea ──
  useEffect(() => {
    if (draftTextareaRef.current) {
      draftTextareaRef.current.style.height = "auto";
      draftTextareaRef.current.style.height = draftTextareaRef.current.scrollHeight + "px";
    }
  }, [localDraft]);

  // ── Draft editing marks dirty flag ──
  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalDraft(e.target.value);
    localDirtyRef.current = true;
    debouncedSave(e.target.value);
  };

  // ── Send message ──
  const sendMessage = async (message: string) => {
    if (!gen.generationId || !message.trim() || loading) return;
    setLoading(true);
    setError(null);
    cancelSaveTimer();

    // Optimistic user message
    setGen((prev: any) => ({
      ...prev,
      chatMessages: [...prev.chatMessages, { role: "user", content: message.trim() }],
    }));

    try {
      const draftChanged = localDraft !== serverDraftRef.current;
      const res = await api.ghostwrite(gen.generationId, message.trim(), draftChanged ? localDraft : undefined);

      localDirtyRef.current = false;

      setGen((prev: any) => ({
        ...prev,
        // Set originalDraft on first response (explicit null check, not ||)
        originalDraft: prev.originalDraft != null && prev.originalDraft !== ""
          ? prev.originalDraft
          : (res.draft ?? prev.originalDraft),
        finalDraft: res.draft ?? prev.finalDraft,
        chatMessages: [...prev.chatMessages, { role: "assistant", content: res.message, tools_used: res.tools_used }],
      }));
    } catch (err: any) {
      setError(err.message ?? "Failed. Try again.");
      // Rollback optimistic user message
      setGen((prev: any) => ({
        ...prev,
        chatMessages: prev.chatMessages.slice(0, -1),
      }));
    } finally {
      setLoading(false);
    }
  };

  // ── StrictMode-safe auto-start ──
  useEffect(() => {
    if (gen.generationId && gen.chatMessages.length === 0 && !startedRef.current) {
      startedRef.current = true;
      sendMessage(gen.combiningGuidance?.trim() || "Combine these drafts into a single strong post.");
    }
  }, [gen.generationId]);

  // ── Cleanup save timer on unmount ──
  useEffect(() => {
    return () => cancelSaveTimer();
  }, []);

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
  const isFirstTurn = gen.chatMessages.length === 0;
  const hasAssistantMessage = gen.chatMessages.some(m => m.role === "assistant");

  return (
    <div className="flex flex-col lg:flex-row min-h-[70vh] gap-5">
      {/* ── Left panel: Chat ── */}
      <div className="w-full lg:w-1/2 flex flex-col min-h-0">
        {/* Error banner */}
        {error && (
          <div className="mb-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[14px] text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-400/60 hover:text-red-400 text-[13px]">
              Dismiss
            </button>
          </div>
        )}

        <AgentChat
          messages={gen.chatMessages}
          onSend={sendMessage}
          loading={loading}
          placeholder="Give feedback, ask questions, or request changes..."
        />
      </div>

      {/* ── Right panel: Editable draft ── */}
      <div className="w-full lg:w-1/2 flex flex-col min-h-0">
        {/* First-turn sentinel label */}
        {isFirstTurn && loading && (
          <div className="mb-2 text-[13px] text-gen-text-3 tracking-wide animate-pulse">
            Combining drafts...
          </div>
        )}
        {!hasAssistantMessage && !loading && localDraft && (
          <div className="mb-2 text-[13px] text-gen-text-3 tracking-wide">
            Starting draft
          </div>
        )}

        {/* Draft textarea */}
        <div className="flex-1">
          <textarea
            ref={draftTextareaRef}
            value={localDraft}
            onChange={handleDraftChange}
            className={`w-full h-full bg-gen-bg-1/30 border border-gen-border-1 rounded-xl px-5 py-4 text-[15px] leading-[1.85] text-gen-text-1 resize-none focus-visible:outline-none focus-visible:border-gen-accent/40 min-h-[400px] ${
              draftHighlight
                ? "bg-gen-accent/5 transition-colors duration-500"
                : "transition-colors duration-500"
            }`}
            style={{ fontFamily: "var(--font-sans)" }}
          />
        </div>

        {/* Draft footer */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-3">
            <span className="text-[14px] text-gen-text-3 tabular-nums">{wordCount} words</span>
            <button
              onClick={onBack}
              className="text-[14px] text-gen-text-3 hover:text-gen-text-1 transition-colors duration-150 ease-[var(--ease-snappy)]"
            >
              Back to drafts
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[15px] font-medium rounded-[10px] hover:border-gen-border-3 transition-colors duration-150 ease-[var(--ease-snappy)]"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={handleOpenLinkedIn}
              className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[15px] font-medium rounded-[10px] hover:bg-white transition-colors duration-150 ease-[var(--ease-snappy)]"
            >
              Open in LinkedIn
            </button>
            {onRetro && (
              <button
                onClick={onRetro}
                className="px-4 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-2 text-[15px] font-medium rounded-[10px] hover:border-gen-accent/40 hover:text-gen-accent transition-colors duration-150 ease-[var(--ease-snappy)]"
              >
                Post Retro
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
