// src/app/banker/deals/[dealId]/discovery/page.tsx
"use client";

import React, { useEffect, useState, use } from "react";

function card() {
  return "rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_0_40px_rgba(56,189,248,0.12)]";
}

export default function BankerDealDiscoveryPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = use(params);

  const [status, setStatus] = useState<any>(null);
  const [ownership, setOwnership] = useState<any>(null);
  const [uwDraft, setUwDraft] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const s = await fetch(`/api/deals/${dealId}/credit-discovery/status`);
      const sd = await s.json();
      if (!sd.ok) throw new Error(sd.error || "Discovery status failed");
      setStatus(sd);

      const o = await fetch(`/api/deals/${dealId}/ownership/compute`, { method: "POST" });
      const od = await o.json();
      if (od.ok) setOwnership(od);

    } catch (e: any) {
      setErr(e?.message || "Unknown error");
    }
  }

  useEffect(() => { load();   }, []);

  async function generateUwDraft() {
    setErr(null);
    setUwDraft(null);
    try {
      // Call the enhanced credit memo generation endpoint
      const r = await fetch(`/api/deals/${dealId}/credit-memo/generate`, { method: "POST" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Credit memo generation failed");
      setUwDraft({ 
        memo: d.memo, 
        memoId: d.memoId,
        message: "Credit memo generated successfully with citations" 
      });
    } catch (e: any) {
      setErr(e?.message || "Unknown error");
    }
  }

  const session = status?.session;
  const facts = status?.facts || [];

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-white/60">Banker • Credit Discovery</div>
            <div className="text-2xl font-semibold mt-1">Deal {dealId.slice(0, 8)}…</div>
            <div className="text-white/60 mt-2">
              This is pre-underwriting discovery: completeness, risks, ownership, and readiness.
            </div>
          </div>
          <div className={`${card()} p-4 min-w-[220px]`}>
            <div className="text-xs text-white/60">Readiness</div>
            <div className="text-xl font-semibold mt-1">{Number(session?.completeness ?? 0).toFixed(0)}%</div>
            <div className="text-xs text-white/60 mt-2">Status: <span className="text-white/90">{session?.status || "—"}</span></div>
            <div className="text-xs text-white/60 mt-1">Missing: {(session?.missing_domains || []).join(", ") || "None"}</div>
          </div>
        </div>

        {err && (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
            <div className="font-semibold text-rose-200">Error</div>
            <div className="text-rose-100/80 text-sm mt-1">{err}</div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <div className={`${card()} p-4 lg:col-span-2`}>
            <div className="font-semibold">Discovered Facts</div>
            <div className="text-white/60 text-sm mt-1">Structured facts (sources + confidence can be added to UI next).</div>
            <div className="mt-3 space-y-2 max-h-[520px] overflow-auto pr-2">
              {facts.length === 0 ? (
                <div className="text-white/60 text-sm">No facts yet.</div>
              ) : (
                facts.slice(0, 80).map((f: any) => (
                  <div key={f.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{f.domain}.{f.key}</div>
                      <div className="text-xs text-white/60">{Math.round(Number(f.confidence || 0))}%</div>
                    </div>
                    <pre className="text-xs text-white/70 mt-2 whitespace-pre-wrap">
                      {JSON.stringify(f.value_json, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className={`${card()} p-4`}>
              <div className="font-semibold">Ownership Intelligence</div>
              <div className="text-white/60 text-sm mt-1">Entities, edges, and derived requirements.</div>
              <div className="mt-3 text-xs text-white/70">
                Owners detected: {ownership?.entities?.filter((e: any) => e.entity_type === "person").length ?? 0}
              </div>
              <div className="mt-2 text-xs text-white/70">
                Requirements: {ownership?.requirements?.length ?? 0}
              </div>
              <button
                className="mt-4 w-full px-4 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 transition text-sm"
                onClick={load}
              >
                Refresh Ownership
              </button>
            </div>

            <div className={`${card()} p-4`}>
              <div className="font-semibold">Underwriting Copilot</div>
              <div className="text-white/60 text-sm mt-1">Draft memo + risks + missing UW items.</div>
              <button
                className="mt-4 w-full px-4 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 transition text-sm"
                onClick={generateUwDraft}
              >
                Generate Credit Memo Draft
              </button>
            </div>
          </div>
        </div>

        {uwDraft && (
          <div className={`${card()} p-5 mt-6`}>
            <div className="font-semibold">Credit Memo Draft (AI)</div>
            <div className="text-white/60 text-sm mt-1">Review/edit required. AI does not approve anything.</div>
            <pre className="text-xs text-white/75 mt-4 whitespace-pre-wrap">
              {JSON.stringify(uwDraft, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
