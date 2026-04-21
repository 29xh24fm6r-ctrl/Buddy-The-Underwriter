"use client";

// src/components/feasibility/FeasibilityScoreCapsule.tsx
// Phase God Tier Feasibility — Phase 2 Gap B (step 7/9).
// Small read-only badge that fetches the deal's latest feasibility score
// and renders score + recommendation next to the other DealShell metrics.
// Renders null when no study exists so it doesn't crowd deals that
// haven't been analyzed yet.

import { useEffect, useState } from "react";

function colorFor(score: number): string {
  if (score >= 80)
    return "bg-emerald-600/20 text-emerald-300 border-emerald-500/30";
  if (score >= 65) return "bg-blue-600/20 text-blue-300 border-blue-500/30";
  if (score >= 50) return "bg-amber-600/20 text-amber-200 border-amber-500/30";
  if (score >= 35)
    return "bg-orange-600/20 text-orange-200 border-orange-500/30";
  return "bg-rose-600/20 text-rose-200 border-rose-500/30";
}

interface LatestStudy {
  composite_score: number;
  recommendation: string;
  confidence_level: string;
}

export function FeasibilityScoreCapsule({ dealId }: { dealId: string }) {
  const [data, setData] = useState<{
    score: number;
    recommendation: string;
    confidence: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/feasibility/latest`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.ok && json.study) {
          const s = json.study as LatestStudy;
          setData({
            score: s.composite_score,
            recommendation: s.recommendation,
            confidence: s.confidence_level,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (!data) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <span className="text-xs text-white/60">Feasibility</span>
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${colorFor(data.score)}`}
      >
        {data.score}/100
      </span>
      <span className="text-xs text-white/60">{data.recommendation}</span>
    </div>
  );
}
