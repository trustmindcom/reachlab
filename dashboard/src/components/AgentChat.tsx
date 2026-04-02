import { useState, useRef, useEffect } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tools_used?: string[];
}

interface AgentChatProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  loading: boolean;
  placeholder?: string;
  className?: string;
  userBubbleClass?: string;
  assistantBubbleClass?: string;
  inputClass?: string;
  buttonClass?: string;
  toolBadgeClass?: string;
  typingIndicatorClass?: string;
  disabled?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "Searched the web",
  fetch_url: "Read article",
  add_or_update_rule: "Updated rules",
  query_posts: "Searched posts",
  get_insights: "Checked insights",
  get_recommendations: "Checked recommendations",
};

export default function AgentChat({
  messages,
  onSend,
  loading,
  placeholder = "Type a message...",
  className = "",
  userBubbleClass = "bg-gen-accent/15 text-gen-text-1",
  assistantBubbleClass = "bg-gen-bg-2 border border-gen-border-1 text-gen-text-2",
  inputClass = "bg-gen-bg-2 border border-gen-border-2 text-gen-text-1 placeholder:text-gen-text-3 focus-visible:ring-gen-accent/50 focus-visible:border-gen-accent-border",
  buttonClass = "bg-gen-accent text-white disabled:bg-gen-bg-3 disabled:text-gen-text-3",
  toolBadgeClass = "bg-gen-bg-3 text-gen-text-3 border border-gen-border-1",
  typingIndicatorClass = "bg-gen-bg-2 border border-gen-border-1",
  disabled,
}: AgentChatProps) {
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !loading && !disabled) {
        onSend(input);
        setInput("");
      }
    }
  };

  const handleSend = () => {
    if (input.trim() && !loading && !disabled) {
      onSend(input);
      setInput("");
    }
  };

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-2 mb-3" style={{ maxHeight: "calc(70vh - 80px)" }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] px-4 py-2.5 text-[15px] leading-relaxed ${
                msg.role === "user"
                  ? `rounded-2xl rounded-br-md ${userBubbleClass}`
                  : `rounded-2xl rounded-bl-md ${assistantBubbleClass}`
              }`}
            >
              {msg.content.split("\n").map((line, j) => (
                <p key={j} className={j > 0 ? "mt-1.5" : ""}>{line}</p>
              ))}
              {msg.role === "assistant" && msg.tools_used && msg.tools_used.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {msg.tools_used.map((tool, k) => (
                    <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded ${toolBadgeClass}`}>
                      {TOOL_LABELS[tool] ?? tool.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className={`px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-1.5 ${typingIndicatorClass}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-pulse" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-pulse" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-pulse" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 mt-auto">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading || disabled}
          placeholder={placeholder}
          rows={1}
          className={`flex-1 rounded-lg px-3 py-2.5 text-[15px] resize-none focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${inputClass}`}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading || disabled}
          className={`px-4 py-2 text-[14px] font-medium rounded-lg transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-40 self-end ${buttonClass}`}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
