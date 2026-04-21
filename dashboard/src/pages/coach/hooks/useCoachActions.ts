import { useState } from "react";
import {
  api,
  type Recommendation,
  type PromptSuggestions,
  type PendingRetro,
  type RetroPromptEdit,
} from "../../../api/client";

export function useCoachActions(showError: (msg: string) => void) {
  const [activeRecs, setActiveRecs] = useState<Recommendation[]>([]);
  const [resolvedRecs, setResolvedRecs] = useState<Recommendation[]>([]);
  const [promptSuggestions, setPromptSuggestions] = useState<PromptSuggestions | null>(null);
  const [pendingRetros, setPendingRetros] = useState<PendingRetro[]>([]);
  const [appliedRetroEdits, setAppliedRetroEdits] = useState<Set<string>>(new Set());

  const load = () => {
    const fail = (what: string) => () => showError(`Failed to load ${what}`);

    api.getPendingRetros().then((r) => setPendingRetros(r.retros)).catch(err => console.error("[Coach] Failed to load retros:", err));
    api.recommendationsWithCooldown().then((r) => {
      setActiveRecs(r.active);
      setResolvedRecs(r.resolved);
    }).catch(fail("recommendations"));
    api.insightsPromptSuggestions().then((r) => setPromptSuggestions(r.prompt_suggestions)).catch(err => console.error("[Coach] Failed to load prompt suggestions:", err));
  };

  const handleResolve = (id: number, type: "accepted" | "dismissed") => {
    api.resolveRecommendation(id, type).then(() => {
      setActiveRecs((prev) => prev.filter((r) => r.id !== id));
      setResolvedRecs((prev) => {
        const rec = activeRecs.find((r) => r.id === id);
        if (rec) return [{ ...rec, resolved_type: type, resolved_at: new Date().toISOString() }, ...prev];
        return prev;
      });
    }).catch(() => showError("Failed to save recommendation"));
  };

  const handleFeedback = (id: number, rating: string) => {
    api.recommendationFeedback(id, rating).catch(() => showError("Failed to save feedback"));
  };

  const handleAcceptSuggestion = async (_index: number, suggestion: { current: string; suggested: string; evidence: string }) => {
    const currentPromptRes = await api.getWritingPrompt().catch(() => ({ text: null }));
    const currentText = currentPromptRes.text ?? "";
    let newText: string;
    if (currentText.includes(suggestion.current)) {
      newText = currentText.replace(suggestion.current, suggestion.suggested);
    } else if (currentText.includes(suggestion.suggested)) {
      return;
    } else {
      newText = currentText + "\n" + suggestion.suggested;
    }
    await api.saveWritingPrompt(newText, "ai_suggestion", suggestion.evidence).catch(() => showError("Failed to save prompt"));
    setPromptSuggestions(null);
  };

  const handleApplyRetroEdit = async (retroId: number, editIndex: number, edit: RetroPromptEdit) => {
    const key = `${retroId}-${editIndex}`;
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
      await api.markRetroApplied(retroId);
      setAppliedRetroEdits((prev) => new Set(prev).add(key));
      setPendingRetros((prev) => prev.filter((r) => r.generation_id !== retroId));
    } catch (err) { console.error("[Coach] Failed to apply retro edit:", err); }
  };

  const handleDismissRetro = async (retroId: number) => {
    try {
      await api.markRetroApplied(retroId);
      setPendingRetros((prev) => prev.filter((r) => r.generation_id !== retroId));
    } catch (err) {
      console.error("[Coach] Failed to dismiss retro:", err);
      showError("Failed to dismiss retro");
    }
  };

  return {
    activeRecs,
    resolvedRecs,
    promptSuggestions,
    pendingRetros,
    appliedRetroEdits,
    load,
    handleResolve,
    handleFeedback,
    handleAcceptSuggestion,
    handleApplyRetroEdit,
    handleDismissRetro,
  };
}
