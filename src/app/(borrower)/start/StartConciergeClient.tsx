"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BorrowerWorkspaceGate, type VerifiedSession } from "@/components/brokerage/BorrowerWorkspaceGate";
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
import { CapturedFactsPanel } from "@/components/brokerage/CapturedFactsPanel";
import { ExistingDebtCard } from "@/components/brokerage/ExistingDebtCard";
import { IdentityVerificationCard } from "@/components/brokerage/IdentityVerificationCard";
import { SigningPanel } from "@/components/brokerage/SigningPanel";
import { consumeConciergeStream } from "@/lib/brokerage/consumeConciergeStream";

type Msg = { role: "user" | "assistant"; content: string; streaming?: boolean };
type Mode = "chat" | "voice";

const MODE_KEY = "buddy.start.mode";

// Journey status refreshes every 20s while a deal exists — cheap enough
// (single indexed-lookup query) to poll, and it's the only way /start
// finds out about server-side transitions (sealed, listed, claimed) that
// don't happen from a borrower action on this page.
const JOURNEY_POLL_MS = 20_000;

// Plain-language labels for the field keys computeNextRequiredFields()
// returns (src/app/api/brokerage/concierge/route.ts) — that list was already
// computed and sent on every turn, just never rendered anywhere.
const NEXT_STEP_LABELS: Record<string, string> = {
  "borrower.first_name": "your name",
  "borrower.email": "your email",
  "business.legal_name_or_industry": "your business",
  "loan.amount_requested": "how much you're financing",
  "loan.use_of_proceeds": "what the money is for",
  "business.is_franchise": "whether you're financing a franchise",
};

export function describeNextSteps(fields: string[]): string | null {
  if (fields.length === 0) return null;
  const labels = fields.map((f) => NEXT_STEP_LABELS[f] ?? f);
  if (labels.length === 1) return `One thing left: ${labels[0]}.`;
  const last = labels[labels.length - 1];
  const rest = labels.slice(0, -1).join(", ");
  return `${labels.length} things left: ${rest} and ${last}.`;
}

// How long after a voice turn completes to force a facts refresh — long
// enough to give the gateway's server-side extraction call a real chance to
// land, short enough that it reads as "Buddy heard me" rather than a stall.
const VOICE_TURN_REFRESH_DELAY_MS = 2_500;

function useJourneyStatus(
  dealId: string | null,
  onFacts?: (facts: Record<string, unknown>) => void,
): JourneyStatusInput & { refreshSoon: () => void } {
  const [status, setStatus] = useState<JourneyStatusInput>({
    hasDealId: false,
    progressPct: 0,
    documentsUploadedCount: 0,
    sealed: false,
    listingStatus: null,
    matchedLenderCount: 0,
    claimsCount: 0,
  });

  const refresh = useCallback(
    async (id: string) => {
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
        // Voice-captured facts reach the browser via this poll — voice
        // extraction runs server-side inside the Fly gateway's dispatch
        // call, with no client-visible "extraction done" event. Text chat
        // updates facts synchronously on each turn (see ChatPane's send());
        // this callback is what lets voice-mode corrections/captures show
        // up in the same CapturedFactsPanel. refreshSoon (below) shortens
        // the usual wait for this from the full poll interval to a few
        // seconds after each voice turn.
        if (json.facts && typeof json.facts === "object") onFacts?.(json.facts);
      } catch {
        // non-fatal — keep showing last known status
      }
    },
    [onFacts],
  );

  useEffect(() => {
    // dealId starts null (default status already has hasDealId: false) and
    // is only ever set once the concierge chat resolves a deal — nothing
    // to fetch, and nothing to reset, until then.
    if (!dealId) return;
    void refresh(dealId);
    const timer = window.setInterval(() => void refresh(dealId), JOURNEY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [dealId, refresh]);

  const refreshSoon = useCallback(() => {
    if (!dealId) return;
    window.setTimeout(() => void refresh(dealId), VOICE_TURN_REFRESH_DELAY_MS);
  }, [dealId, refresh]);

  return { ...status, refreshSoon };
}

export function StartConciergeClient({
  initialPath,
  initialSession = null,
}: {
  initialPath?: "franchise" | "standard";
  initialSession?: VerifiedSession | null;
}) {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") return "chat";
    const saved = window.localStorage.getItem(MODE_KEY);
    return saved === "voice" ? "voice" : "chat";
  });
  const [session, setSession] = useState<VerifiedSession | null>(initialSession);
  const dealId = session?.dealId ?? null;
  const [facts, setFacts] = useState<Record<string, unknown>>({});
  const journeyStatus = useJourneyStatus(dealId, setFacts);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODE_KEY, mode);
    }
  }, [mode]);

  if (!session) {
    return <BorrowerWorkspaceGate onVerified={setSession} />;
  }

  return (
    <div>
      <div className="mb-3 text-center">
        <p className="text-sm text-slate-500">
          {session.name ? `Welcome, ${session.name} — this` : "This"} is your private workspace.{" "}
          <button
            type="button"
            onClick={async () => {
              if (
                !window.confirm(
                  "Start a brand-new application on this device? Your current one is safe — you can always get back to it by re-verifying with the email you used.",
                )
              ) {
                return;
              }
              await fetch("/api/brokerage/session/clear", { method: "POST" });
              window.location.reload();
            }}
            className="font-medium text-slate-500 underline decoration-dotted hover:text-slate-800"
          >
            Not you? Start a new application
          </button>
        </p>
      </div>
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
      <div className="mb-5">
        <BorrowerJourneyChecklist status={journeyStatus} />
      </div>
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

      <p className="mb-4 text-center text-xs text-slate-500">
        Would rather talk to a person?{" "}
        <a
          href="mailto:hello@buddytheunderwriter.com"
          className="font-medium text-slate-700 underline hover:text-slate-900"
        >
          Email hello@buddytheunderwriter.com
        </a>{" "}
        any time.
      </p>

      <div className="mb-4 space-y-3">
        <CapturedFactsPanel facts={facts} onCorrected={setFacts} />
        <ExistingDebtCard dealId={session.dealId} />
      </div>

      {mode === "chat" ? (
        <ChatPane
          dealId={session.dealId}
          borrowerName={session.name}
          initialPath={initialPath}
          onFactsUpdated={setFacts}
        />
      ) : (
        <BorrowerVoicePanel dealId={session.dealId} onAssistantTurn={journeyStatus.refreshSoon} />
      )}

      <div className="mt-4">
        <BorrowerFranchiseBrandPicker startInSearchMode={initialPath === "franchise"} />
      </div>

      <IdentityVerificationCard dealId={session.dealId} />
      <SigningPanel dealId={session.dealId} />
      <SealPackageCard dealId={session.dealId} />
    </div>
  );
}

function ChatPane({
  dealId,
  borrowerName,
  initialPath,
  onFactsUpdated,
}: {
  dealId: string;
  borrowerName: string | null;
  initialPath?: "franchise" | "standard";
  onFactsUpdated: (facts: Record<string, unknown>) => void;
}) {
  const greeting = borrowerName ? `Hi ${borrowerName}, I'm` : "I'm";
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        initialPath === "franchise"
          ? `${greeting} Buddy. Since you're financing a franchise, tell me the brand and what you're buying — I'll pull in SBA certification and FDD data automatically and guide the next step.`
          : `${greeting} Buddy. I help you build an SBA-ready borrower package from the start. Tell me what you want to finance and I'll guide the next step.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingReply, setStreamingReply] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [nextRequiredFields, setNextRequiredFields] = useState<string[]>([]);
  const [rateLimited, setRateLimited] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const FALLBACK_MESSAGE = "I hit a snag. Give me a moment and try once more.";

  // Appends a streamed token to the in-progress assistant bubble, starting
  // a new one on the first token of a turn.
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

  // Replaces the in-progress bubble's content with the server's final text
  // (source of truth) — or appends a fresh bubble if no tokens ever arrived.
  const finalizeStreamingMessage = (finalText: string) => {
    setMessages((m) => {
      const last = m[m.length - 1];
      const text = finalText || last?.content || FALLBACK_MESSAGE;
      if (last?.role === "assistant" && last.streaming) {
        return [...m.slice(0, -1), { role: "assistant", content: text }];
      }
      return [...m, { role: "assistant", content: text }];
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

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && res.body) {
        await consumeConciergeStream(res.body, {
          onToken: appendStreamingToken,
          onDone: (data) => {
            finalizeStreamingMessage(data.assistantMessage ?? data.buddyResponse ?? "");
            setProgressPct(data.progressPct ?? 0);
            setNextRequiredFields(Array.isArray(data.nextRequiredFields) ? data.nextRequiredFields : []);
            if (data.extractedFacts) onFactsUpdated(data.extractedFacts);
          },
          onError: () => finalizeStreamingMessage(FALLBACK_MESSAGE),
        });
      } else {
        // Short-circuit paths (trident intent, assumptions confirm, errors)
        // still return a plain JSON response — no streaming needed since
        // they don't call the model for the reply text.
        const data = await res.json();
        if (data.ok) {
          setMessages((m) => [
            ...m,
            { role: "assistant", content: data.buddyResponse },
          ]);
          setProgressPct(data.progressPct ?? 0);
          setNextRequiredFields(Array.isArray(data.nextRequiredFields) ? data.nextRequiredFields : []);
          if (data.extractedFacts) onFactsUpdated(data.extractedFacts);
        } else {
          setMessages((m) => [...m, { role: "assistant", content: FALLBACK_MESSAGE }]);
        }
      }
    } catch {
      finalizeStreamingMessage(FALLBACK_MESSAGE);
    } finally {
      setSending(false);
      setStreamingReply(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.08)]">
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">Your SBA package</span>
          <span className="text-slate-500">{progressPct}% ready</span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-label="SBA package readiness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
        >
          <div
            className="h-full bg-gradient-to-r from-[#1c8de0] to-[#4db8f0] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {describeNextSteps(nextRequiredFields) && (
          <p className="mt-2 text-xs text-slate-500">{describeNextSteps(nextRequiredFields)}</p>
        )}
      </div>

      <div
        ref={listRef}
        className="h-[460px] space-y-4 overflow-y-auto px-6 py-5"
        role="log"
        aria-live="polite"
        aria-busy={streamingReply}
        aria-label="Conversation with Buddy"
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
              {m.streaming && (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-slate-400 align-text-bottom" />
              )}
            </div>
          </div>
        ))}
        {sending && !streamingReply && (
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
        <p className="mt-2 text-xs text-slate-500">
          Saved to your workspace — verify with this email on any device to pick up right where you left off.
        </p>
      </div>
    </div>
  );
}
