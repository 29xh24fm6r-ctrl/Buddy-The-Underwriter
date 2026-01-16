"use client";

import React, { useEffect, useState, use } from "react";

function glowCard() {
  return "rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_0_40px_rgba(56,189,248,0.12)]";
}

function fmtCurrency(n: number | null | undefined) {
  if (typeof n !== "number") return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number | null | undefined) {
  if (typeof n !== "number") return "—";
  return `${n.toFixed(0)}%`;
}

type SummaryResponse = {
  ok: boolean;
  snapshot: any;
  rentRoll: { as_of_date: string | null; rows: any[] };
  t12: {
    total_income_ttm: any;
    opex_ttm: any;
    noi_ttm: any;
  };
  last_updated: string | null;
  error?: string;
};

export default function BorrowerFinancialSummaryPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = use(params);

  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem("buddy_invite_token");
        if (!token) throw new Error("No invite token found");

        const res = await fetch(`/api/portal/deals/${dealId}/financial-summary`, {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error ?? "Failed to load");
        setData(json);
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [dealId]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div
        className="fixed inset-0 pointer-events-none opacity-40"
        style={{
          background:
            "radial-gradient(1200px 700px at 20% 10%, rgba(56,189,248,0.10), transparent 60%), radial-gradient(900px 600px at 80% 40%, rgba(217,70,239,0.08), transparent 55%), radial-gradient(900px 700px at 50% 90%, rgba(16,185,129,0.06), transparent 60%)",
        }}
      />
      <div className="mx-auto max-w-5xl px-4 py-8 relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-white/60">Financial Summary</div>
            <div className="text-2xl font-semibold mt-1">Here’s what we’re using for your underwriting</div>
            <div className="text-white/60 mt-2">
              This view is read-only. If anything looks off, let your banker know.
            </div>
          </div>
          <div className={`${glowCard()} p-3 min-w-[200px]`}>
            <div className="text-xs text-white/60">Last updated</div>
            <div className="text-lg font-semibold mt-1">{data?.last_updated ?? "—"}</div>
          </div>
        </div>

        {loading && (
          <div className={`${glowCard()} p-5 mt-6`}>Loading summary…</div>
        )}

        {error && (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
            <div className="font-semibold text-rose-200">Error</div>
            <div className="text-rose-100/80 text-sm mt-1">{error}</div>
          </div>
        )}

        {!loading && data && !error && (
          <div className="space-y-6 mt-6">
            <div className={`${glowCard()} p-5`}>
              <div className="text-xs text-white/60">Key facts</div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-white/50">NOI (TTM)</div>
                  <div className="text-lg font-semibold">{fmtCurrency(data.snapshot?.noi_ttm?.value_num)}</div>
                </div>
                <div>
                  <div className="text-xs text-white/50">Total Income (TTM)</div>
                  <div className="text-lg font-semibold">{fmtCurrency(data.snapshot?.total_income_ttm?.value_num)}</div>
                </div>
                <div>
                  <div className="text-xs text-white/50">Operating Expenses (TTM)</div>
                  <div className="text-lg font-semibold">{fmtCurrency(data.snapshot?.opex_ttm?.value_num)}</div>
                </div>
                <div>
                  <div className="text-xs text-white/50">Occupancy</div>
                  <div className="text-lg font-semibold">{fmtPct(data.snapshot?.occupancy_pct?.value_num)}</div>
                </div>
              </div>
            </div>

            <div className={`${glowCard()} p-5`}>
              <div className="text-xs text-white/60">T12 summary</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-white/50">Total Income</div>
                  <div className="text-lg font-semibold">{fmtCurrency(data.t12?.total_income_ttm?.value_num)}</div>
                </div>
                <div>
                  <div className="text-xs text-white/50">Operating Expenses</div>
                  <div className="text-lg font-semibold">{fmtCurrency(data.t12?.opex_ttm?.value_num)}</div>
                </div>
                <div>
                  <div className="text-xs text-white/50">NOI</div>
                  <div className="text-lg font-semibold">{fmtCurrency(data.t12?.noi_ttm?.value_num)}</div>
                </div>
              </div>
            </div>

            <div className={`${glowCard()} p-5`}>
              <div className="text-xs text-white/60">Rent roll (read-only)</div>
              <div className="text-xs text-white/40 mt-1">As of {data.rentRoll?.as_of_date ?? "—"}</div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-white/50">
                      <th className="text-left py-2 pr-4">Unit</th>
                      <th className="text-left py-2 pr-4">Tenant</th>
                      <th className="text-left py-2 pr-4">Sqft</th>
                      <th className="text-left py-2 pr-4">Lease Start</th>
                      <th className="text-left py-2 pr-4">Lease End</th>
                      <th className="text-left py-2 pr-4">Monthly Rent</th>
                      <th className="text-left py-2 pr-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.rentRoll?.rows ?? []).slice(0, 50).map((row: any, idx: number) => (
                      <tr key={`${row.unit_id ?? "unit"}-${idx}`} className="border-t border-white/5">
                        <td className="py-2 pr-4">{row.unit_id ?? "—"}</td>
                        <td className="py-2 pr-4">{row.tenant_name ?? "—"}</td>
                        <td className="py-2 pr-4">{row.sqft ?? "—"}</td>
                        <td className="py-2 pr-4">{row.lease_start ?? "—"}</td>
                        <td className="py-2 pr-4">{row.lease_end ?? "—"}</td>
                        <td className="py-2 pr-4">{fmtCurrency(row.monthly_rent)}</td>
                        <td className="py-2 pr-4">{row.occupancy_status ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(data.rentRoll?.rows ?? []).length > 50 && (
                  <div className="mt-2 text-xs text-white/40">Showing first 50 rows.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
