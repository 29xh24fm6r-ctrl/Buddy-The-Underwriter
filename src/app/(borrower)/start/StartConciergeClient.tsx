"use client";

import { useEffect, useRef, useState } from "react";
import BorrowerVoicePanel from "@/components/brokerage/BorrowerVoicePanel";

type Msg = { role: "user" | "assistant"; content: string };
type Mode = "chat" | "voice";

const MODE_KEY = "buddy.start.mode";

export function StartConciergeClient() {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") return "chat";
    const saved = window.localStorage.getItem(MODE_KEY);
    return saved === "voice" ? "voice" : "chat";
  });
  const [dealId, setDealId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODE_KEY, mode);
    }
  }, [mode]);

  return (
    <div>
      <div className="mb-4 p-1 bg-slate-100 rounded-lg flex gap-1">
        <button
          onClick={() => setMode("chat")}
          className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === "chat"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
          type="button"
        >
          💬 Chat
        </button>
        <button
          onClick={() => setMode("voice")}
          className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === "voice"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
          type="button"
        >
          🎤 Voice
        </button>
      </div>

      {mode === "chat" ? (
        <ChatPane dealId={dealId} onDealIdResolved={setDealId} />
      ) : dealId ? (
        <BorrowerVoicePanel dealId={dealId} />
      ) : (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-600 mb-4">
            Send Buddy a chat message first so we can set up your session.
            Voice becomes available the moment your package starts.
          </p>
          <button
            onClick={() => setMode("chat")}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
            type="button"
          >
            Switch to chat
          </button>
        </div>
      )}
    </div>
  );
}

function ChatPane({
  dealId,
  onDealIdResolved,
}: {
  dealId: string | null;
  onDealIdResolved: (id: string) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi, I'm Buddy. I help borrowers get SBA loans with full institutional packages and up to 3 competing lender claims. Tell me a little about what you're looking to finance — I'll take it from there.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [rateLimited, setRateLimited] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const res = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userMessage: text }),
        credentials: "include",
      });

      if (res.status === 429) {
        setRateLimited(true);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "You're sending messages a little faster than I can keep up with. Give me a minute and try again.",
          },
        ]);
        setTimeout(() => setRateLimited(false), 60_000);
        return;
      }

      const data = await res.json();
      if (data.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: data.buddyResponse },
        ]);
        setProgressPct(data.progressPct ?? 0);
        if (data.dealId) onDealIdResolved(data.dealId);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: "I hit a snag. Give me a moment and try once more.",
          },
        ]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "I hit a snag. Give me a moment and try once more.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-700 font-medium">Your package</span>
          <span className="text-slate-500">{progressPct}% ready</span>
        </div>
        <div className="mt-2 h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div
        ref={listRef}
        className="h-[460px] overflow-y-auto px-6 py-5 space-y-4"
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user" ? "flex justify-end" : "flex justify-start"
            }
          >
            <div
              className={
                m.role === "user"
                  ? "bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-2 max-w-[80%]"
                  : "bg-slate-100 text-slate-900 rounded-2xl rounded-bl-md px-4 py-2 max-w-[80%]"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 text-slate-500 rounded-2xl rounded-bl-md px-4 py-2">
              Buddy is thinking…
            </div>
          </div>
        )}
      </div>

      <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Tell me about your business and what you need…"
            className="flex-1 px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={sending || rateLimited}
          />
          <button
            onClick={send}
            disabled={sending || rateLimited || !input.trim()}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        {dealId && (
          <p className="mt-2 text-xs text-slate-500">
            Session saved. Close this tab and return anytime from this browser.
          </p>
        )}
      </div>
    </div>
  );
}
