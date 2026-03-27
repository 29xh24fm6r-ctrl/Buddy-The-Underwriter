"use client";

/**
 * Phase 60 — Insight Panel
 *
 * Banker-facing decision synthesis. Summary + risks + mitigants +
 * opportunities + blockers + next action. Always below IntelligencePanel.
 */

import { useEffect, useState } from "react";

type InsightItem = {
  code: string;
  label: string;
  detail: string | null;
  severity: string;
  category: string;
};

type InsightState = {
  status: "not_ready" | "ready" | "partial" | "attention_needed";
  summary: string;
  recommendation: string | null;
  risks: InsightItem[];
  mitigants: InsightItem[];
  opportunities: InsightItem[];
  blockers: InsightItem[];
  nextAction: { label: string; href: string | null; intent: string } | null;
  evidence: {
    snapshotReady: boolean;
    lenderMatchReady: boolean;
    riskReady: boolean;
    lifecycleReady: boolean;
    intelligenceRunning: boolean;
  };
};

const STATUS_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  ready: { label: "Ready", color: "text-emerald-300", border: "border-emerald-500/20 bg-emerald-950/10" },
  partial: { label: "In Progress", color: "text-sky-300", border: "border-sky-500/20 bg-sky-950/10" },
  attention_needed: { label: "Attention Needed", color: "text-amber-300", border: "border-amber-500/20 bg-amber-950/10" },
  not_ready: { label: "Not Ready", color: "text-white/40", border: "border-white/10 bg-white/[0.02]" },
};

export function InsightPanel({ dealId }: { dealId: string }) {
  const [insight, setInsight] = useState<InsightState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/insights`);
        const data = await res.json();
        if (data?.ok) setInsight(data.insight);
      } catch { /* degrade */ }
      finally { setLoading(false); }
    })();
  }, [dealId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 animate-pulse">
        <div className="h-4 bg-white/10 rounded w-2/3 mb-2" />
        <div className="h-3 bg-white/5 rounded w-1/2" />
      </div>
    );
  }

  if (!insight) return null;

  const config = STATUS_CONFIG[insight.status] ?? STATUS_CONFIG.not_ready;

  return (
    <div className={`rounded-xl border ${config.border} px-4 py-3 space-y-3`}>
      {/* Hero strip */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-wide ${config.color}`}>
            {config.label}
          </span>
          <span className="text-xs text-white/60">{insight.summary}</span>
        </div>
        {insight.nextAction && (
          <a
            href={insight.nextAction.href ?? "#"}
            className="text-[10px] font-semibold bg-white/10 text-white/70 px-2 py-1 rounded hover:bg-white/15"
          >
            {insight.nextAction.label}
          </a>
        )}
      </div>

      {/* Recommendation */}
      {insight.recommendation && (
        <div className="text-xs text-white/50 italic">
          Recommended: {insight.recommendation}
        </div>
      )}

      {/* Four buckets */}
      <div className="grid grid-cols-2 gap-2">
        {insight.risks.length > 0 && (
          <InsightBucket title="Risks" items={insight.risks} color="red" />
        )}
        {insight.mitigants.length > 0 && (
          <InsightBucket title="Mitigants" items={insight.mitigants} color="emerald" />
        )}
        {insight.opportunities.length > 0 && (
          <InsightBucket title="Opportunities" items={insight.opportunities} color="sky" />
        )}
        {insight.blockers.length > 0 && (
          <InsightBucket title="Blockers" items={insight.blockers} color="amber" />
        )}
      </div>

      {/* Evidence footer */}
      <div className="flex items-center gap-3 text-[10px] text-white/20">
        <span>Based on:</span>
        <span className={insight.evidence.snapshotReady ? "text-emerald-400/50" : "text-white/20"}>snapshot</span>
        <span className={insight.evidence.lenderMatchReady ? "text-emerald-400/50" : "text-white/20"}>lenders</span>
        <span className={insight.evidence.riskReady ? "text-emerald-400/50" : "text-white/20"}>risk</span>
        <span className={insight.evidence.lifecycleReady ? "text-emerald-400/50" : "text-white/20"}>lifecycle</span>
      </div>
    </div>
  );
}

function InsightBucket({ title, items, color }: { title: string; items: InsightItem[]; color: string }) {
  const colorMap: Record<string, string> = {
    red: "text-red-300",
    emerald: "text-emerald-300",
    sky: "text-sky-300",
    amber: "text-amber-300",
  };

  return (
    <div>
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${colorMap[color] ?? "text-white/40"} mb-1`}>
        {title} ({items.length})
      </div>
      <ul className="space-y-0.5">
        {items.slice(0, 3).map((item) => (
          <li key={item.code} className="text-[11px] text-white/50 truncate" title={item.detail ?? item.label}>
            {item.label}
          </li>
        ))}
        {items.length > 3 && (
          <li className="text-[10px] text-white/30">+{items.length - 3} more</li>
        )}
      </ul>
    </div>
  );
}
