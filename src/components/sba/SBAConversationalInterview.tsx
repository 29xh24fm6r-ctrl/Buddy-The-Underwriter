"use client";

// src/components/sba/SBAConversationalInterview.tsx
// Phase 3 — Chat-style alternative to the form-based assumption interview.
// The borrower sees Buddy's drafted assumptions as cards inside Buddy
// messages and refines them in natural language. Each user message POSTs
// to /sba/chat-refine which returns a conversational reply plus a set of
// structured patches to apply to the SBAAssumptions state.

import { useEffect, useRef, useState } from "react";
import type {
  SBAAssumptions,
  RevenueStream,
} from "@/lib/sba/sbaReadinessTypes";

type BuddyMessage = {
  role: "buddy";
  content: string;
  cards?: AssumptionCard[];
};
type UserMessage = { role: "user"; content: string };
type Message = BuddyMessage | UserMessage;

type AssumptionCard = {
  title: string;
  lines: string[];
};

interface Props {
  dealId: string;
  assumptions: SBAAssumptions;
  onAssumptionsChange: (next: SBAAssumptions) => void;
  onConfirmed: () => void;
}

// Build a compact set of cards summarizing the current assumptions so they
// can appear inline inside Buddy's first message.
function buildCardsFromAssumptions(a: SBAAssumptions): AssumptionCard[] {
  const fmtMoney = (n: number) =>
    n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(2)}M`
      : n >= 1_000
        ? `$${Math.round(n / 1_000)}K`
        : `$${Math.round(n)}`;
  const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

  const revenueLines = (a.revenueStreams ?? []).map(
    (s: RevenueStream) =>
      `${s.name || "Stream"}: ${fmtMoney(s.baseAnnualRevenue)}/yr, growth ${pct(s.growthRateYear1)} → ${pct(s.growthRateYear2)} → ${pct(s.growthRateYear3)}`,
  );

  return [
    {
      title: "Revenue",
      lines:
        revenueLines.length > 0
          ? revenueLines
          : ["No revenue streams drafted yet."],
    },
    {
      title: "Costs",
      lines: [
        `COGS: ${pct(a.costAssumptions.cogsPercentYear1)} of revenue`,
        `${a.costAssumptions.fixedCostCategories.length} fixed cost categories`,
      ],
    },
    {
      title: "Working Capital",
      lines: [
        `DSO: ${a.workingCapital.targetDSO} days`,
        `DPO: ${a.workingCapital.targetDPO} days`,
      ],
    },
    {
      title: "Loan & Funding",
      lines: [
        `Loan: ${fmtMoney(a.loanImpact.loanAmount)} @ ${pct(a.loanImpact.interestRate, 2)} · ${a.loanImpact.termMonths} mo`,
        `Equity injection: ${fmtMoney(a.loanImpact.equityInjectionAmount)}`,
      ],
    },
    {
      title: "Management Team",
      lines:
        a.managementTeam.length === 0
          ? ["No team members on file."]
          : a.managementTeam.map(
              (m) =>
                `${m.name || "Unnamed"} — ${m.title}${m.ownershipPct != null ? ` (${pct(m.ownershipPct)})` : ""}`,
            ),
    },
  ];
}

// Safely apply a single dotted-path patch to assumptions.
// Supported paths: "revenueStreams[0].growthRateYear1",
// "costAssumptions.cogsPercentYear1", "loanImpact.interestRate",
// "workingCapital.targetDSO", "managementTeam[0].bio", etc.
function applyPatch(
  a: SBAAssumptions,
  path: string,
  value: unknown,
): SBAAssumptions {
  const tokens: Array<string | number> = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    tokens.push(m[1] ?? Number(m[2]));
  }
  if (tokens.length === 0) return a;

  // Deep-clone only enough of the tree to mutate safely.
  const clone: unknown = JSON.parse(JSON.stringify(a));
  let cursor: Record<string, unknown> | unknown[] = clone as Record<
    string,
    unknown
  >;
  for (let i = 0; i < tokens.length - 1; i++) {
    const tok = tokens[i];
    const next = (cursor as Record<string | number, unknown>)[
      tok as keyof typeof cursor
    ];
    if (next === null || typeof next !== "object") return a; // path broken
    cursor = next as Record<string, unknown> | unknown[];
  }
  const last = tokens[tokens.length - 1];
  (cursor as Record<string | number, unknown>)[last as keyof typeof cursor] =
    value as never;
  return clone as SBAAssumptions;
}

export default function SBAConversationalInterview({
  dealId,
  assumptions,
  onAssumptionsChange,
  onConfirmed,
}: Props) {
  const [messages, setMessages] = useState<Message[]>(() => {
    const cards = buildCardsFromAssumptions(assumptions);
    return [
      {
        role: "buddy",
        content:
          "Hi — I've already analyzed your financial statements and researched your industry. Here's what I've drafted so far. Tell me what to change in plain English (e.g. \"Year 1 growth should be 20% — we just signed a major contract\") and I'll update the numbers.",
        cards,
      },
    ];
  });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [confirmedSections, setConfirmedSections] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setSending(true);
    // Append user message optimistically.
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");

    // Trim history to last 10 messages to control token use.
    const history = messages.slice(-10).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      const res = await fetch(`/api/deals/${dealId}/sba/chat-refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          currentAssumptions: assumptions,
          conversationHistory: history,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Refinement failed");
        return;
      }

      // Apply structured patches to assumptions.
      let next = assumptions;
      const patches: Array<{ path: string; value: unknown }> = Array.isArray(
        json.patches,
      )
        ? json.patches
        : [];
      for (const p of patches) {
        if (typeof p.path === "string") {
          next = applyPatch(next, p.path, p.value);
        }
      }
      if (next !== assumptions) onAssumptionsChange(next);

      if (typeof json.sectionConfirmed === "string" && json.sectionConfirmed) {
        setConfirmedSections((prev) => ({
          ...prev,
          [json.sectionConfirmed]: true,
        }));
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "buddy",
          content: String(json.reply ?? "Got it — updated."),
          cards:
            next !== assumptions ? buildCardsFromAssumptions(next) : undefined,
        },
      ]);
    } catch {
      setError("Network error while sending message");
    } finally {
      setSending(false);
    }
  }

  const allSectionsConfirmed = [
    "revenue",
    "costs",
    "workingCapital",
    "loan",
    "management",
  ].every((k) => confirmedSections[k]);

  return (
    <div className="flex h-[70vh] flex-col rounded-xl border border-white/10 bg-white/[0.02]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-blue-500 border-t-transparent" />
            Buddy is thinking…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-white/10 p-3 space-y-2">
        {allSectionsConfirmed && (
          <button
            type="button"
            onClick={onConfirmed}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Generate My Business Plan
          </button>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your response…"
            className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm text-white whitespace-pre-line">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        <div className="rounded-2xl rounded-bl-sm bg-white/5 border border-white/10 px-4 py-2 text-sm text-white/80 whitespace-pre-line">
          {message.content}
        </div>
        {message.cards && message.cards.length > 0 && (
          <div className="grid gap-2">
            {message.cards.map((card) => (
              <div
                key={card.title}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="text-xs font-semibold text-blue-400 mb-1">
                  {card.title}
                </div>
                <ul className="space-y-0.5 text-xs text-white/70">
                  {card.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
