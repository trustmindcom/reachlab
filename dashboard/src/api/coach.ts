import { withPersonaId } from "./helpers.js";

export const coachApi = {
  coachChat: (sessionId: number | null, message: string) =>
    fetch(withPersonaId(`/api/coach/chat`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
    }).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `API error: ${r.status}`);
      }
      return r.json() as Promise<{ session_id: number; message: string; tools_used: string[] }>;
    }),

  coachChatSessions: () =>
    fetch(withPersonaId(`/api/coach/chat/sessions`)).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ sessions: Array<{ id: number; title: string | null; created_at: string; updated_at: string }> }>;
    }),

  coachChatMessages: (sessionId: number) =>
    fetch(withPersonaId(`/api/coach/chat/sessions/${sessionId}/messages`)).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<{ messages: Array<{ id: number; role: "user" | "assistant"; content: string; tool_blocks_json: string | null; created_at: string }> }>;
    }),
};
