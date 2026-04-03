import { getUnscoped, withPersonaId } from "./helpers.js";
import type {
  DiscoveryResponse,
  GenResearchResponse,
  GenDraftsResponse,
  GenChatResponse,
  GenChatMessage,
  GenCombineResponse,
  GhostwriteResponse,
  GenRulesResponse,
  GenHistoryResponse,
  GenHistoryDetail,
  GenCoachingSyncResponse,
  GenCoachingInsight,
  GenSource,
  RetroResponse,
  RetroAnalysis,
  PendingRetro,
  AuthorProfileResponse,
  InterviewSessionResponse,
  ExtractedProfileResponse,
} from "./types.js";

export const generateApi = {
  // ── Generate Pipeline ─────────────────────────────────────

  generateDiscover: () =>
    fetch(withPersonaId(`/api/generate/discover`), { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<DiscoveryResponse>;
    }),

  generateResearch: (topic: string, avoid?: string[], sourceContext?: { summary: string; source_headline: string; source_url: string }) =>
    fetch(withPersonaId(`/api/generate/research`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        ...(avoid && avoid.length > 0 && { avoid }),
        ...(sourceContext && { source_context: sourceContext }),
      }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenResearchResponse>;
    }),

  generateDrafts: (researchId: number, storyIndex: number, personalConnection?: string, length?: "short" | "medium" | "long") =>
    fetch(withPersonaId(`/api/generate/drafts`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        research_id: researchId,
        story_index: storyIndex,
        personal_connection: personalConnection,
        length,
      }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenDraftsResponse>;
    }),

  reviseDrafts: (generationId: number, feedback: string) =>
    fetch(withPersonaId(`/api/generate/revise-drafts`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, feedback }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenDraftsResponse>;
    }),

  generateChat: (generationId: number, message: string, editedDraft?: string) =>
    fetch(withPersonaId(`/api/generate/chat`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, message, edited_draft: editedDraft }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenChatResponse>;
    }),

  generateChatHistory: (generationId: number) =>
    fetch(withPersonaId(`/api/generate/${generationId}/messages`)).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenChatMessage[]>;
    }),

  generateCombine: (generationId: number, selectedDrafts: number[], combiningGuidance?: string) =>
    fetch(withPersonaId(`/api/generate/combine`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, selected_drafts: selectedDrafts, combining_guidance: combiningGuidance }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenCombineResponse>;
    }),

  ghostwrite: (generationId: number, message: string, currentDraft?: string) =>
    fetch(withPersonaId(`/api/generate/ghostwrite`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId, message, current_draft: currentDraft }),
    }).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `API error: ${r.status}`);
      }
      return r.json() as Promise<GhostwriteResponse>;
    }),

  saveSelection: (generationId: number, indices: number[], guidance?: string) =>
    fetch(withPersonaId(`/api/generate/${generationId}/selection`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_draft_indices: indices, combining_guidance: guidance }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  saveDraft: (generationId: number, draft: string) =>
    fetch(withPersonaId(`/api/generate/${generationId}/draft`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  // ── Generate Rules ────────────────────────────────────────

  generateGetRules: () =>
    getUnscoped<GenRulesResponse>("/generate/rules"),

  generateSaveRules: (categories: GenRulesResponse["categories"]) =>
    fetch(withPersonaId(`/api/generate/rules`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateResetRules: () =>
    fetch(withPersonaId(`/api/generate/rules/reset`), { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenRulesResponse>;
    }),

  // ── Generate History ──────────────────────────────────────

  getActiveGeneration: () =>
    getUnscoped<{ generation: GenHistoryDetail | null }>("/generate/active"),

  generateHistory: (status = "all", offset = 0, limit = 20) =>
    getUnscoped<GenHistoryResponse>(`/generate/history?status=${status}&offset=${offset}&limit=${limit}`),

  generateHistoryDetail: (id: number) =>
    getUnscoped<GenHistoryDetail>(`/generate/history/${id}`),

  generateDiscard: (id: number) =>
    fetch(withPersonaId(`/api/generate/history/${id}/discard`), { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateDelete: (id: number) =>
    fetch(withPersonaId(`/api/generate/history/${id}`), { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateRetro: (id: number, publishedText: string) =>
    fetch(withPersonaId(`/api/generate/history/${id}/retro`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published_text: publishedText }),
    }).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `API error: ${r.status}`);
      }
      return r.json() as Promise<{ analysis: RetroAnalysis; input_tokens: number; output_tokens: number }>;
    }),

  generateGetRetro: (id: number) =>
    getUnscoped<RetroResponse>(`/generate/history/${id}/retro`),

  generateAddRule: (category: string, ruleText: string) =>
    fetch(withPersonaId(`/api/generate/rules/add`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, rule_text: ruleText }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ ok: boolean }>;
    }),

  // ── Pending Retros (for Coach) ──────────────────────────

  getPendingRetros: () =>
    getUnscoped<{ retros: PendingRetro[] }>("/generate/retros/pending"),

  markRetroApplied: (generationId: number) =>
    fetch(withPersonaId(`/api/generate/retros/${generationId}/apply`), { method: "PATCH" })
      .then((r) => r.json()),

  // ── Coaching Sync ─────────────────────────────────────────

  generateCoachingAnalyze: () =>
    fetch(withPersonaId(`/api/generate/coaching/analyze`), { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenCoachingSyncResponse>;
    }),

  generateCoachingDecide: (changeId: number, action: string, editedText?: string) =>
    fetch(withPersonaId(`/api/generate/coaching/changes/${changeId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, edited_text: editedText }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  generateCoachingHistory: () =>
    getUnscoped<{ syncs: Array<{ id: number; created_at: string; changes_count: number }> }>("/generate/coaching/history"),

  generateCoachingInsights: () =>
    getUnscoped<{ insights: GenCoachingInsight[] }>("/generate/coaching/insights"),

  // ── Sources ────────────────────────────────────────────────

  getSources: () =>
    getUnscoped<{ sources: GenSource[] }>("/sources"),

  addSource: (url: string) =>
    fetch(withPersonaId(`/api/sources`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `API error: ${r.status}`);
      return data as { source: GenSource };
    }),

  updateSource: (id: number, updates: { enabled?: boolean; name?: string }) =>
    fetch(withPersonaId(`/api/sources/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  deleteSource: (id: number) =>
    fetch(withPersonaId(`/api/sources/${id}`), { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    }),

  // ── Source Discovery ────────────────────────────────────

  discoverSources: (topics?: string[]) =>
    fetch(withPersonaId(`/api/sources/discover`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topics }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      const data = await r.json();
      return data.sources as Array<{ name: string; url: string; feed_url: string | null; description: string }>;
    }),

  backfillSources: () =>
    fetch(withPersonaId(`/api/sources/backfill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ sources: Array<{ name: string; url: string; feed_url: string | null; description: string }>; removed: number; added: number; message?: string }>;
    }),

  // ── Author Profile ──────────────────────────────────────────

  getAuthorProfile: () =>
    getUnscoped<AuthorProfileResponse>("/author-profile"),

  saveAuthorProfile: (profile_text: string, profile_json?: Record<string, any>) =>
    fetch(withPersonaId(`/api/author-profile`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_text, profile_json }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  createInterviewSession: () =>
    fetch(withPersonaId(`/api/author-profile/interview/session`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `API error: ${r.status}`);
      }
      return r.json() as Promise<InterviewSessionResponse>;
    }),

  extractProfile: (transcript: string, duration_seconds?: number) =>
    fetch(withPersonaId(`/api/author-profile/extract`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, duration_seconds }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<ExtractedProfileResponse>;
    }),
};
