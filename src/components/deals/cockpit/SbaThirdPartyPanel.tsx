"use client";

/**
 * SPEC S5 A-7 — third-party order status table in the Story tab. Banker
 * runs the trigger engine, picks an approved vendor, confirms dispatch
 * (sends the order email), and later uploads the delivered result.
 */

import { useCallback, useEffect, useState } from "react";

type ThirdPartyOrder = {
  id: string;
  order_type: string;
  status: "triggered" | "dispatched" | "in_progress" | "delivered" | "parsed" | "cancelled";
  trigger_reason: string | null;
  vendor_id: string | null;
  expected_completion_at: string | null;
  result_storage_path: string | null;
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  real_estate_appraisal: "Real Estate Appraisal",
  business_valuation: "Business Valuation",
  phase_1_environmental: "Phase I Environmental",
  phase_2_environmental: "Phase II Environmental",
  hazard_insurance: "Hazard Insurance",
  life_insurance: "Life Insurance",
  title_commitment: "Title Commitment",
  ucc_lien_search: "UCC Lien Search",
};

const STATUS_LABEL: Record<ThirdPartyOrder["status"], string> = {
  triggered: "Not dispatched",
  dispatched: "⏳ Dispatched",
  in_progress: "⏳ In progress",
  delivered: "📄 Delivered",
  parsed: "✓ Parsed",
  cancelled: "✗ Cancelled",
};

export default function SbaThirdPartyPanel({ dealId }: { dealId: string }) {
  const [orders, setOrders] = useState<ThirdPartyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/deals/${dealId}/third-party/orders`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setOrders(data.orders ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  const runEvaluation = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(`/api/deals/${dealId}/third-party/evaluate`, { method: "POST" });
      load();
    } finally {
      setBusy(false);
    }
  }, [dealId, load]);

  const glassSection = "rounded-xl border border-white/8 bg-white/[0.02] p-4";
  const sectionLabel = "text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3";

  if (loading) {
    return (
      <div className={glassSection}>
        <div className={sectionLabel}>Third-Party Orders</div>
        <div className="h-16 rounded-lg bg-white/5 animate-pulse" />
      </div>
    );
  }

  return (
    <div className={glassSection}>
      <div className="mb-3 flex items-center justify-between">
        <div className={sectionLabel + " mb-0"}>Third-Party Orders</div>
        <button
          type="button"
          onClick={runEvaluation}
          disabled={busy}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/60 hover:bg-white/10 disabled:opacity-40"
        >
          Evaluate triggers
        </button>
      </div>

      {orders.length === 0 ? (
        <p className="text-xs text-white/40">No third-party orders yet. Click "Evaluate triggers" to check what's required.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-white/40">
              <th className="pb-2 pr-3 font-semibold">Order</th>
              <th className="pb-2 pr-3 font-semibold">Status</th>
              <th className="pb-2 pr-3 font-semibold">Reason</th>
              <th className="pb-2 pr-3 font-semibold">Result</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-white/8">
                <td className="py-2 pr-3 text-white/80">{ORDER_TYPE_LABEL[o.order_type] ?? o.order_type}</td>
                <td className="py-2 pr-3 text-white/60">{STATUS_LABEL[o.status]}</td>
                <td className="py-2 pr-3 text-white/40">{o.trigger_reason ?? "—"}</td>
                <td className="py-2 pr-3 text-white/40">{o.result_storage_path ? "✓ On file" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
