import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import AgentChat, { type ChatMessage } from "./AgentChat";

interface CoachChatPanelProps {
  open: boolean;
  onClose: () => void;
}

interface Session {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export default function CoachChatPanel({ open, onClose }: CoachChatPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevOpenRef = useRef(false);

  // Fetch sessions when panel opens
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      api.coachChatSessions()
        .then((r) => {
          setSessions(r.sessions);
          if (r.sessions.length > 0 && currentSessionId === null) {
            setCurrentSessionId(r.sessions[0].id);
          }
        })
        .catch(() => {});
    }
    prevOpenRef.current = open;
  }, [open]);

  // Fetch messages when session changes
  useEffect(() => {
    if (currentSessionId === null) {
      setMessages([]);
      return;
    }
    api.coachChatMessages(currentSessionId)
      .then((r) => {
        setMessages(
          r.messages.map((m) => {
            let tools_used: string[] | undefined;
            if (m.tool_blocks_json) {
              try {
                const blocks = JSON.parse(m.tool_blocks_json);
                tools_used = blocks
                  .filter((b: any) => b.role === "assistant")
                  .flatMap((b: any) =>
                    Array.isArray(b.content)
                      ? b.content.filter((c: any) => c.type === "tool_use").map((c: any) => c.name)
                      : []
                  );
              } catch { /* ignore */ }
            }
            return { role: m.role, content: m.content, tools_used };
          })
        );
      })
      .catch(() => setMessages([]));
  }, [currentSessionId]);

  const handleSend = async (message: string) => {
    setLoading(true);
    setError(null);

    // Optimistic user message
    setMessages((prev) => [...prev, { role: "user", content: message.trim() }]);

    try {
      const res = await api.coachChat(currentSessionId, message.trim());

      // If this was a new session, update session id and refresh list
      if (currentSessionId === null) {
        setCurrentSessionId(res.session_id);
        api.coachChatSessions().then((r) => setSessions(r.sessions)).catch(() => {});
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.message, tools_used: res.tools_used },
      ]);
    } catch (err: any) {
      setError(err.message ?? "Failed to send message");
      // Rollback optimistic message
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setError(null);
  };

  const handleSessionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "new") {
      handleNewChat();
    } else {
      setCurrentSessionId(Number(val));
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 transition-opacity duration-200"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] max-w-full bg-surface-0 border-l border-border z-50 flex flex-col transition-transform duration-200 ease-[var(--ease-snappy)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <select
            value={currentSessionId ?? "new"}
            onChange={handleSessionChange}
            className="flex-1 bg-surface-1 border border-border rounded-md px-2 py-1.5 text-[14px] text-text-primary truncate focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
          >
            <option value="new">New chat</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title ?? `Chat ${s.id}`}
              </option>
            ))}
          </select>
          <button
            onClick={handleNewChat}
            className="px-2.5 py-1.5 bg-accent/10 text-accent text-[13px] font-medium rounded-md hover:bg-accent/20 transition-colors shrink-0"
          >
            New
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-[14px] text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-400/60 hover:text-red-400 text-[13px]">
              Dismiss
            </button>
          </div>
        )}

        {/* Chat body */}
        <div className="flex-1 min-h-0 px-4 py-3">
          <AgentChat
            messages={messages}
            onSend={handleSend}
            loading={loading}
            placeholder="Ask your coach anything..."
            className="h-full"
            userBubbleClass="bg-accent/15 text-text-primary"
            assistantBubbleClass="bg-surface-1 border border-border text-text-secondary"
            inputClass="bg-surface-1 border border-border text-text-primary placeholder:text-text-muted focus-visible:ring-accent/50 focus-visible:border-accent/40"
            buttonClass="bg-accent text-white disabled:bg-surface-2 disabled:text-text-muted"
            toolBadgeClass="bg-surface-2 text-text-muted border border-border"
            typingIndicatorClass="bg-surface-1 border border-border text-text-muted"
          />
        </div>
      </div>
    </>
  );
}
