"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BorrowerVoicePanel from "@/components/brokerage/BorrowerVoicePanel";
import { consumeConciergeStream } from "@/lib/brokerage/consumeConciergeStream";

type Msg = { role: "user" | "assistant"; content: string; streaming?: boolean };
type Mode = "chat" | "voice";

const DRAWER_KEY = "buddy.concierge.open";

export function FloatingConcierge({
  dealId,
  borrowerName,
}: {
  dealId: string;
  borrowerName: string | null;
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DRAWER_KEY) === "true";
  });
  const [mode, setMode] = useState<Mode>("chat");

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DRAWER_KEY, String(open));
    }
  }, [open]);

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-blue-500 to-brand-blue-400 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:brightness-110"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Chat with Buddy
        </button>
      )}

      {/* Slide-up drawer */}
      {open && (
        <div className="fixed bottom-0 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] animate-in slide-in-from-bottom duration-300">
          <div className="overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl">
            {/* Drawer header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setMode("chat")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === "chat"
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setMode("voice")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === "voice"
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Voice
                </button>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close chat"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Content */}
            {mode === "chat" ? (
              <DrawerChatPane dealId={dealId} borrowerName={borrowerName} />
            ) : (
              <div className="p-4">
                <BorrowerVoicePanel dealId={dealId} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function DrawerChatPane({
  dealId,
  borrowerName,
}: {
  dealId: string;
  borrowerName: string | null;
}) {
  const greeting = borrowerName ? `Hi ${borrowerName}, I'm` : "I'm";
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: `${greeting} Buddy. Ask me anything about your application — I'm here to help.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingReply, setStreamingReply] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const FALLBACK = "I hit a snag. Give me a moment and try once more.";

  const appendStreamingToken = (delta: string) => {
    setStreamingReply(true);
    setMessages((m) => {
      const last = m[m.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        return [...m.slice(0, -1), { ...last, content: last.content + delta }];
      }
      return [...m, { role: "assistant", content: delta, streaming: true }];
    });
  };

  const finalizeStreamingMessage = (text: string) => {
    setMessages((m) => {
      const last = m[m.length - 1];
      const final = text || last?.content || FALLBACK;
      if (last?.role === "assistant" && last.streaming) {
        return [...m.slice(0, -1), { role: "assistant", content: final }];
      }
      return [...m, { role: "assistant", content: final }];
    });
  };

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
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/event-stream") && res.body) {
        await consumeConciergeStream(res.body, {
          onToken: appendStreamingToken,
          onDone: (data) => {
            finalizeStreamingMessage(data.assistantMessage ?? data.buddyResponse ?? "");
          },
          onError: () => finalizeStreamingMessage(FALLBACK),
        });
      } else {
        const data = await res.json();
        if (data.ok) {
          setMessages((m) => [...m, { role: "assistant", content: data.buddyResponse }]);
        } else {
          setMessages((m) => [...m, { role: "assistant", content: FALLBACK }]);
        }
      }
    } catch {
      finalizeStreamingMessage(FALLBACK);
    } finally {
      setSending(false);
      setStreamingReply(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "400px" }}>
      <div
        ref={listRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
        role="log"
        aria-live="polite"
        aria-busy={streamingReply}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                m.role === "user"
                  ? "brand-gradient-cta max-w-[85%] rounded-2xl rounded-br-md px-3 py-2.5 text-xs text-white"
                  : "max-w-[85%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2.5 text-xs text-slate-900"
              }
            >
              {m.content}
              {m.streaming && (
                <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-slate-400 align-text-bottom" />
              )}
            </div>
          </div>
        ))}
        {sending && !streamingReply && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2.5 text-xs text-slate-500">
              Buddy is thinking…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="flex gap-1.5">
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
            placeholder="Ask Buddy anything…"
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
            disabled={sending}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="brand-gradient-cta rounded-xl px-3 py-2 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
