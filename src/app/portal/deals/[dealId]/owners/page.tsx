// src/app/portal/deals/[dealId]/owners/page.tsx
"use client";

import React, { useEffect, useState, use } from "react";

function card() {
  return "rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_0_40px_rgba(56,189,248,0.12)]";
}

export default async function OwnersPortalPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = use(params);

  const [graph, setGraph] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/ownership/compute`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Ownership compute failed");
      setGraph(data);
    } catch (e: any) {
      setErr(e?.message || "Unknown error");
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const reqs = graph?.requirements || [];
  const ents = graph?.entities || [];

  const ownerName = (id: string) => ents.find((e: any) => e.id === id)?.display_name || id;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="text-xs text-white/60">Owner / Guarantor Portal</div>
        <div className="text-2xl font-semibold mt-1">Personal items required (if applicable)</div>
        <div className="text-white/60 mt-2">
          If you own <span className="text-white/90 font-medium">20% or more</span>, we may need a Personal Financial Statement,
          3 years of personal tax returns, and a personal guaranty.
        </div>

        {err && (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
            <div className="font-semibold text-rose-200">Error</div>
            <div className="text-rose-100/80 text-sm mt-1">{err}</div>
          </div>
        )}

        <div className={`${card()} p-5 mt-6`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Detected owner requirements</div>
              <div className="text-white/60 text-sm mt-1">Based on current ownership info. Banker may confirm.</div>
            </div>
            <button
              className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 transition text-sm"
              onClick={load}
            >
              Refresh
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {reqs.length === 0 ? (
              <div className="text-white/60 text-sm">
                No owner requirements detected yet. If ownership wasn't provided, complete the credit discovery ownership step.
              </div>
            ) : (
              reqs.map((r: any) => (
                <div key={r.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{ownerName(r.owner_entity_id)}</div>
                    <div className="text-xs text-white/60 capitalize">{r.status}</div>
                  </div>
                  <div className="text-xs text-white/60 mt-2">Required items:</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(r.required_items || []).map((it: string) => (
                      <span key={it} className="px-2 py-1 rounded-full border border-white/15 bg-white/5 text-xs">
                        {it}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-white/50">
                    (Upload UI wiring comes next: connect to your existing portal upload flow by owner.)
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
