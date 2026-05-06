"use client";

import React, { useEffect, useState } from "react";
import MemoVersionDiffView from "./MemoVersionDiffView";
import RiskDeltaPanel from "./RiskDeltaPanel";
import UnderwriterDecisionAnalytics from "./UnderwriterDecisionAnalytics";
import type { CreditMemoIntelligencePayload } from "@/lib/creditMemo/intelligence/types";

type State =
  | { kind: "loading" }
  | { kind: "ready"; payload: CreditMemoIntelligencePayload }
  | { kind: "error"; message: string };

export default function CreditMemoIntelligencePanels({ dealId }: { dealId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/credit-memo/intelligence`, {
          signal: AbortSignal.timeout(20_000),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          setState({ kind: "error", message: data?.error ?? `HTTP ${res.status}` });
          return;
        }
        setState({
          kind: "ready",
          payload: data as CreditMemoIntelligencePayload & { ok: true },
        });
      } catch (e: any) {
        if (cancelled) return;
        setState({ kind: "error", message: String(e?.message ?? e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (state.kind === "loading") {
    return (
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <div className="text-xs text-gray-500 italic">Loading credit memo intelligence…</div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
        <div className="text-[11px] font-semibold text-amber-700 uppercase mb-1">
          Intelligence panel unavailable
        </div>
        <div className="text-xs text-amber-800">{state.message}</div>
      </section>
    );
  }

  const { payload } = state;
  return (
    <div className="space-y-4">
      <RiskDeltaPanel riskDelta={payload.risk_delta} />
      <MemoVersionDiffView diff={payload.version_diff} />
      <UnderwriterDecisionAnalytics analytics={payload.decision_analytics} />
    </div>
  );
}
