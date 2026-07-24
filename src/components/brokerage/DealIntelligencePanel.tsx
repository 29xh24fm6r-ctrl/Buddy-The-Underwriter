"use client";

import { useEffect, useState } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";

/**
 * Deal-level intelligence — commission splits (spec §7.4) and
 * deterministic-first AI assistance (spec §7.8). AI results are always
 * drafts for a human to read; nothing here is auto-applied.
 */

function centsToDollars(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

type Split = { id: string; split_type: string; amount_cents: number | null; split_bps: number | null; status: string };

export function DealIntelligencePanel({ dealId }: { dealId: string }) {
  const [splits, setSplits] = useState<Split[]>([]);
  const [loadingSplits, setLoadingSplits] = useState(true);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ action: string; text: string; requiresHumanReview: boolean } | null>(null);

  async function loadSplits() {
    setLoadingSplits(true);
    try {
      const res = await fetch(`/api/admin/brokerage/deals/${dealId}/commission-splits`);
      const data = await res.json();
      if (data?.ok) setSplits(data.splits ?? []);
    } finally {
      setLoadingSplits(false);
    }
  }

  useEffect(() => {
    void loadSplits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function initializeSplits() {
    setLoadingSplits(true);
    try {
      await fetch(`/api/admin/brokerage/deals/${dealId}/commission-splits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initialize" }),
      });
      await loadSplits();
    } finally {
      setLoadingSplits(false);
    }
  }

  async function runAiAssist(action: "summarize_deal_activity" | "explain_stalled" | "draft_follow_up_email") {
    setAiBusy(action);
    setAiResult(null);
    try {
      const res = await fetch("/api/admin/brokerage/crm/intelligence/ai-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, dealId }),
      });
      const data = await res.json();
      if (data?.ok) setAiResult(data.result);
    } finally {
      setAiBusy(null);
    }
  }

  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 15 }}>
        Deal intelligence
      </div>

      <div style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: c.textSecondary }}>Commission splits</span>
          <button
            onClick={() => void initializeSplits()}
            disabled={loadingSplits}
            style={{ fontSize: 10.5, color: c.brassBright, background: "transparent", border: `1px solid ${c.border}`, borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}
          >
            {loadingSplits ? "Working…" : "Initialize from attribution"}
          </button>
        </div>
        {splits.length === 0 ? (
          <div style={{ fontSize: 11, color: c.textMuted }}>No commission splits yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {splits.map((s) => (
              <div key={s.id} style={{ fontSize: 11, color: c.textSecondary, display: "flex", justifyContent: "space-between" }}>
                <span>{s.split_type.replace("_", " ")} ({s.split_bps != null ? `${s.split_bps / 100}%` : "—"})</span>
                <span>{centsToDollars(s.amount_cents)} · {s.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "12px 16px", borderTop: `1px solid ${c.divider}` }}>
        <div style={{ fontSize: 12, color: c.textSecondary, marginBottom: 8 }}>AI assist (draft only — review before acting)</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => void runAiAssist("summarize_deal_activity")} disabled={aiBusy != null} style={{ fontSize: 10.5, color: c.paper, background: "transparent", border: `1px solid ${c.border}`, borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>
            {aiBusy === "summarize_deal_activity" ? "Working…" : "Summarize activity"}
          </button>
          <button onClick={() => void runAiAssist("explain_stalled")} disabled={aiBusy != null} style={{ fontSize: 10.5, color: c.paper, background: "transparent", border: `1px solid ${c.border}`, borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>
            {aiBusy === "explain_stalled" ? "Working…" : "Explain why stalled"}
          </button>
          <button onClick={() => void runAiAssist("draft_follow_up_email")} disabled={aiBusy != null} style={{ fontSize: 10.5, color: c.paper, background: "transparent", border: `1px solid ${c.border}`, borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>
            {aiBusy === "draft_follow_up_email" ? "Working…" : "Draft follow-up email"}
          </button>
        </div>
        {aiResult && (
          <div style={{ marginTop: 10, fontSize: 11, color: c.textSecondary, whiteSpace: "pre-wrap", background: "rgba(0,0,0,.15)", borderRadius: 6, padding: 10 }}>
            {aiResult.text}
            {aiResult.requiresHumanReview && <div style={{ marginTop: 6, fontSize: 10, color: c.textMuted }}>⚠ Requires human review before use.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
