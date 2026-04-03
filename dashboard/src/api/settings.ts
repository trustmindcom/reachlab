import { getUnscoped, withPersonaId } from "./helpers.js";
import type { WritingPromptHistory } from "./types.js";

export const settingsApi = {
  // ── Author Photo ────────────────────────────────────────────
  authorPhoto: () =>
    fetch(withPersonaId(`/api/settings/author-photo`)).then((r) =>
      r.ok ? r.blob().then((b) => URL.createObjectURL(b)) : null
    ),
  uploadAuthorPhoto: (file: File) =>
    fetch(withPersonaId(`/api/settings/author-photo`), {
      method: "POST",
      body: file,
      headers: { "Content-Type": file.type },
    }).then((r) => r.json()),
  deleteAuthorPhoto: () =>
    fetch(withPersonaId(`/api/settings/author-photo`), { method: "DELETE" }).then((r) => r.json()),

  // ── Timezone ────────────────────────────────────────────────
  setTimezone: (timezone: string) =>
    fetch(withPersonaId(`/api/settings/timezone`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  // ── Writing Prompt ──────────────────────────────────────────
  getWritingPrompt: () =>
    getUnscoped<{ text: string | null }>("/settings/writing-prompt"),

  saveWritingPrompt: (text: string, source: "manual_edit" | "ai_suggestion", evidence?: string) =>
    fetch(withPersonaId(`/api/settings/writing-prompt`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source, evidence }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  getWritingPromptHistory: () =>
    getUnscoped<{ history: WritingPromptHistory[] }>("/settings/writing-prompt/history"),

  // ── Auto-refresh ────────────────────────────────────────────
  getAutoRefreshSettings: () =>
    getUnscoped<{ schedule: string; post_threshold: number }>("/settings/auto-refresh"),

  saveAutoRefreshSettings: (settings: { schedule?: string; post_threshold?: number }) =>
    fetch(withPersonaId(`/api/settings/auto-refresh`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  // ── Sync Health ─────────────────────────────────────────────
  getSyncHealth: () =>
    getUnscoped<{ warnings: Array<{ message: string; detected_at: string }> }>("/settings/sync-health"),

  // ── Generic Settings (KV) ──────────────────────────────────
  getSetting: async (key: string): Promise<string | null> => {
    const res = await fetch(withPersonaId(`/api/settings/kv/${encodeURIComponent(key)}`));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    return data.value;
  },

  setSetting: (key: string, value: string) =>
    fetch(withPersonaId(`/api/settings/kv`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ ok: boolean }>;
    }),

  // ── API Key Config ─────────────────────────────────────────
  getConfigKeys: () =>
    fetch("/api/config/keys").then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ keys: Array<{ key: string; label: string; required: boolean; configured: boolean; prefix: string; url: string }> }>;
    }),

  saveConfigKeys: (keys: Record<string, string>) =>
    fetch(`/api/config/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ ok: boolean }>;
    }),

  // ── Persona Management ─────────────────────────────────────
  listPersonas: () =>
    fetch("/api/personas").then(r => r.json() as Promise<{ personas: import("../context/PersonaContext").Persona[] }>),
  createPersona: (data: { name: string; linkedin_url: string }) =>
    fetch("/api/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(r => r.json()),
  updatePersona: (id: number, data: { name?: string; linkedin_url?: string }) =>
    fetch(`/api/personas/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(r => r.json()),
  getApiToken: (): Promise<{ token: string | null }> =>
    fetch("/api/auth/token").then(r => r.json()),
};
