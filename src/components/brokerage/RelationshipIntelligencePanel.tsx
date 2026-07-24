"use client";

import { useEffect, useState } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";

/**
 * Multi-factor relationship score + referral analytics for one CRM
 * organization — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR5 §7.1/§7.2.
 * Shows component values, not an opaque blended number, per the spec's
 * explicit "do not produce an unexplained opaque score" instruction.
 */

function centsToDollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

export function RelationshipIntelligencePanel({ organizationId }: { organizationId: string }) {
  const [score, setScore] = useState<any | null>(null);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [scoreRes, analyticsRes] = await Promise.all([
          fetch(`/api/admin/brokerage/crm/intelligence?type=relationship-score&orgId=${encodeURIComponent(organizationId)}`),
          fetch(`/api/admin/brokerage/crm/intelligence?type=referral-analytics&orgId=${encodeURIComponent(organizationId)}`),
        ]);
        const scoreJson = await scoreRes.json();
        const analyticsJson = await analyticsRes.json();
        if (!cancelled) {
          if (scoreJson?.ok) setScore(scoreJson.score);
          if (analyticsJson?.ok) setAnalytics(analyticsJson.analytics);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (loading) return <div style={{ fontSize: 11.5, color: c.textMuted, padding: 12 }}>Loading relationship intelligence…</div>;
  if (!score || !analytics) return null;

  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 15 }}>Relationship intelligence</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: c.brassBright }}>{score.overallScore}</span>
      </div>
      <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px 16px", fontSize: 11 }}>
        <div>Recency: <span style={{ color: c.paper }}>{score.components.daysSinceLastContact ?? "—"}d ago</span></div>
        <div>Activity (90d): <span style={{ color: c.paper }}>{score.components.activityCount90d}</span></div>
        <div>Referral volume (12mo): <span style={{ color: c.paper }}>{score.components.referralVolume12mo}</span></div>
        <div>Referral trend: <span style={{ color: c.paper }}>{score.components.referralTrend}</span></div>
        <div>Qualified rate: <span style={{ color: c.paper }}>{pct(score.components.qualifiedReferralRate)}</span></div>
        <div>Conversion rate: <span style={{ color: c.paper }}>{pct(score.components.conversionRate)}</span></div>
        <div>Responsiveness: <span style={{ color: c.paper }}>{pct(score.components.responsiveness)}</span></div>
        <div>Concentration risk: <span style={{ color: c.paper }}>{pct(score.components.concentrationRiskPct)}</span></div>
        <div>Active pipeline: <span style={{ color: c.paper }}>{score.components.activePipelineCount}</span></div>
        <div>Open commitments: <span style={{ color: c.paper }}>{score.components.outstandingCommitments}</span></div>
      </div>
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${c.divider}`, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px 16px", fontSize: 11 }}>
        <div>Leads referred: <span style={{ color: c.paper }}>{analytics.leadsReferred}</span></div>
        <div>Deals funded: <span style={{ color: c.paper }}>{analytics.dealsFunded}</span></div>
        <div>Loan volume: <span style={{ color: c.paper }}>{centsToDollars(analytics.loanVolumeCents)}</span></div>
        <div>Net revenue: <span style={{ color: c.paper }}>{centsToDollars(analytics.netRevenueCents)}</span></div>
        <div>Avg time to conversion: <span style={{ color: c.paper }}>{analytics.avgTimeToConversionDays ?? "—"}d</span></div>
        <div>Avg time to funding: <span style={{ color: c.paper }}>{analytics.avgTimeToFundingDays ?? "—"}d</span></div>
        <div>Referral fee owed: <span style={{ color: c.paper }}>{centsToDollars(analytics.referralFeeObligationsCents)}</span></div>
        <div>Active opportunities: <span style={{ color: c.paper }}>{analytics.activeOpportunities}</span></div>
      </div>
      {analytics.lostReasons.length > 0 && (
        <div style={{ padding: "8px 16px 12px", fontSize: 10.5, color: c.textMuted, borderTop: `1px solid ${c.divider}` }}>
          Lost reasons: {analytics.lostReasons.slice(0, 5).join("; ")}
        </div>
      )}
    </div>
  );
}
