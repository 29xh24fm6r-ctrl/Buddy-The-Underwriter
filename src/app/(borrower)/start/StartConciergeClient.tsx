"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BorrowerVoicePanel from "@/components/brokerage/BorrowerVoicePanel";
import { SealPackageCard } from "@/components/brokerage/SealPackageCard";
import BorrowerFranchiseBrandPicker from "@/components/brokerage/BorrowerFranchiseBrandPicker";
import {
  BrokerageStageStrip,
  BorrowerJourneyChecklist,
  deriveBrokerageStage,
  type JourneyStatusInput,
  type MarketplaceListingStatus,
} from "@/components/brokerage/BrokerageStageStrip";

type Msg = { role: "user" | "assistant"; content: string };
type Mode = "chat" | "voice";

const MODE_KEY = "buddy.start.mode";

// Journey status refreshes every 20s while a deal exists — cheap enough
// (single indexed-lookup query) to poll, and it's the only way /start
// finds out about server-side transitions (sealed, listed, claimed) that
// don't happen from a borrower action on this page.
const JOURNEY_POLL_MS = 20_000;

function useJourneyStatus(dealId: string | null): JourneyStatusInput {
  const [status, setStatus] = useState<JourneyStatusInput>({
    hasDealId: false,
    progressPct: 0,
    documentsUploadedCount: 0,
    sealed: false,
    listingStatus: null,
    matchedLenderCount: 0,
    claimsCount: 0,
  });

  const refresh = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/brokerage/deals/${id}/seal-status`);
      const json = await res.json();
      if (!json?.ok) return;
      setStatus({
        hasDealId: true,
        progressPct: typeof json.progressPct === "number" ? json.progressPct : 0,
        documentsUploadedCount: typeof json.documentsUploadedCount === "number" ? json.documentsUploadedCount : 0,
        sealed: Boolean(json.sealed),
        listingStatus: (json.listing?.status as MarketplaceListingStatus | undefined) ?? null,
        matchedLenderCount: json.listing?.matchedLenderCount ?? 0,
        claimsCount: Array.isArray(json.claims) ? json.claims.length : 0,
      });
    } catch {
      // non-fatal — keep showing last known status
    }
  }, []);

  useEffect(() => {
    // dealId starts null (default status already has hasDealId: false) and
    // is only ever set once the concierge chat resolves a deal — nothing
    // to fetch, and nothing to reset, until then.
    if (!dealId) return;
    void refresh(dealId);
    const timer = window.setInterval(() => void refresh(dealId), JOURNEY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [dealId, refresh]);

  return status;
}

export function StartConciergeClient() {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") return "chat";
    const saved = window.localStorage.getItem(MODE_KEY);
    return saved === "voice" ? "voice" : "chat";
  });
  const [dealId, setDealId] = useState<string | null>(null);
  const journeyStatus = useJourneyStatus(dealId);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODE_KEY, mode);
    }
  }, [mode]);

  return (
    <div>
      <div className="mb-5">
        <BrokerageStageStrip
          activeStage={deriveBrokerageStage({
            hasDealId: journeyStatus.hasDealId,
            progressPct: journeyStatus.progressPct,
            sealed: journeyStatus.sealed,
            listed: journeyStatus.listingStatus === "claiming",
            claimWindowClosed:
              journeyStatus.listingStatus === "awaiting_borrower_pick" ||
              journeyStatus.listingStatus === "picked",
          })}
        />
      </div>
      {dealId && (
        <div className="mb-5">
          <BorrowerJourneyChecklist status={journeyStatus} />
        </div>
      )}
      <div className="mb-4 flex gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
        <button
          onClick={() => setMode("chat")}
          className={`flex-1 rounded-[0.9rem] px-4 py-3 text-sm font-medium transition-colors ${
            mode === "chat"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
          type="button"
        >
          Chat with Buddy
        </button>
        <button
          onClick={() => setMode("voice")}
          className={`flex-1 rounded-[0.9rem] px-4 py-3 text-sm font-medium transition-colors ${
            mode === "voice"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
          type="button"
        >
          Talk with Buddy
        </button>
      </div>

      {mode === "chat" ? (
        <ChatPane dealId={dealId} onDealIdResolved={setDealId} />
      ) : dealId ? (
        <BorrowerVoicePanel dealId={dealId} />
      ) : (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
          <p className="mb-4 text-sm text-slate-600">
            Start with one short message so Buddy can set up your package.
            Voice becomes available as soon as your session is ready.
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

      {dealId && (
        <div className="mt-4">
          <BorrowerFranchiseBrandPicker />
        </div>
      )}

      {dealId && <SealPackageCard dealId={dealId} />}
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
        "I'm Buddy. I help you build an SBA-ready borrower package from the start. Tell me what you want to finance and I'll guide the next step.",
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
    <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.08)]">
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">Your SBA package</span>
          <span className="text-slate-500">{progressPct}% ready</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-gradient-to-r from-[#1c8de0] to-[#4db8f0] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div
        ref={listRef}
        className="h-[460px] space-y-4 overflow-y-auto px-6 py-5"
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
                  ? "brand-gradient-cta max-w-[80%] rounded-2xl rounded-br-md px-4 py-3 text-white"
                  : "max-w-[80%] rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-slate-900"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-slate-500">
              Buddy is preparing your next step…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
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
            placeholder="Tell Buddy about your business and what you want to finance…"
            className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
            disabled={sending || rateLimited}
          />
          <button
            onClick={send}
            disabled={sending || rateLimited || !input.trim()}
            className="brand-gradient-cta rounded-2xl px-5 py-3 font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        {dealId && (
          <p className="mt-2 text-xs text-slate-500">
            Session saved in this browser. Return anytime and keep building your package.
          </p>
        )}
      </div>
    </div>
  );
}
