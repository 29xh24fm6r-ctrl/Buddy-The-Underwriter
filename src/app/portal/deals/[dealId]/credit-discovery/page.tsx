// src/app/portal/deals/[dealId]/credit-discovery/page.tsx
"use client";

import React, { useEffect, useState, use } from "react";

function glowCard() {
  return "rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_0_40px_rgba(56,189,248,0.12)]";
}

export default function BorrowerCreditDiscoveryPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = use(params);

  const [session, setSession] = useState<any>(null);
  const [nextQ, setNextQ] = useState<any>(null);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/credit-discovery/start`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Start failed");
      setSession(data.session);
      setNextQ(data.nextQuestion);
    } catch (e: any) {
      setErr(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function refreshStatus() {
    const res = await fetch(`/api/deals/${dealId}/credit-discovery/status`, { method: "GET" });
    const data = await res.json();
    if (data.ok) setStatus(data);
  }

  useEffect(() => {
    start();
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!session || !nextQ) return;
    if (!answer.trim()) return;

    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/credit-discovery/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          questionId: nextQ.id,
          answerText: answer.trim(),
          actorUserId: null,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Answer failed");

      setSession(data.session);
      setNextQ(data.nextQuestion);
      setAnswer("");
      await refreshStatus();

      // When ownership questions answered, auto compute ownership (best-effort)
      if (String(data.nextQuestion?.domain || "").toLowerCase() === "ownership") {
        await fetch(`/api/deals/${dealId}/ownership/compute`, { method: "POST" });
      }
    } catch (e: any) {
      setErr(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const completeness = Number(session?.completeness ?? 0);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 pointer-events-none opacity-40"
        style={{
          background:
            "radial-gradient(1200px 700px at 20% 10%, rgba(56,189,248,0.10), transparent 60%), radial-gradient(900px 600px at 80% 40%, rgba(217,70,239,0.08), transparent 55%), radial-gradient(900px 700px at 50% 90%, rgba(16,185,129,0.06), transparent 60%)",
        }}
      />
      <div className="mx-auto max-w-3xl px-4 py-8 relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-white/60">Buddy Credit Discovery</div>
            <div className="text-2xl font-semibold mt-1">A few questions to prepare underwriting</div>
            <div className="text-white/60 mt-2">
              This is not paperwork. It's to understand your business and request clearly, so underwriting is fast and accurate.
            </div>
          </div>
          <div className={`${glowCard()} p-3 min-w-[180px]`}>
            <div className="text-xs text-white/60">Progress</div>
            <div className="text-lg font-semibold mt-1">{completeness.toFixed(0)}%</div>
            <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-2 bg-white/40" style={{ width: `${Math.max(2, Math.min(100, completeness))}%` }} />
            </div>
          </div>
        </div>

        {err && (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
            <div className="font-semibold text-rose-200">Error</div>
            <div className="text-rose-100/80 text-sm mt-1">{err}</div>
          </div>
        )}

        <div className={`${glowCard()} p-5 mt-6`}>
          <div className="text-xs text-white/60">Current step</div>
          <div className="text-lg font-semibold mt-1 capitalize">{session?.stage || "…"}</div>
          <div className="text-white/60 text-sm mt-2">
            {nextQ?.why ? `Why we ask: ${nextQ.why}` : " "}
          </div>
        </div>

        <div className={`${glowCard()} p-5 mt-4`}>
          <div className="text-sm text-white/60">Question</div>
          <div className="text-xl font-semibold mt-2">{nextQ?.text || "Loading…"}</div>

          <textarea
            className="mt-4 w-full min-h-[140px] rounded-2xl bg-black/40 border border-white/15 px-4 py-3 outline-none focus:border-white/30"
            placeholder="Type your answer here…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 transition text-sm"
              onClick={refreshStatus}
            >
              Refresh
            </button>
            <button
              className="px-5 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 transition text-sm"
              onClick={submit}
              disabled={loading || !answer.trim()}
            >
              {loading ? "Saving…" : "Continue"}
            </button>
          </div>
        </div>

        {session?.status === "complete" && (
          <div className={`${glowCard()} p-5 mt-4 border-emerald-500/30 bg-emerald-500/10`}>
            <div className="font-semibold text-emerald-200">You're done ✅</div>
            <div className="text-emerald-100/80 text-sm mt-1">
              Credit discovery is complete. Next step: document uploads and underwriting review.
            </div>
          </div>
        )}

        {/* Debug / transparency */}
        <div className="mt-6 text-xs text-white/50">
          Missing domains: {(session?.missing_domains || []).join(", ") || "None"}
        </div>
      </div>
    </div>
  );
}
