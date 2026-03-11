"use client";

import { useEffect, useState } from "react";

export type SpreadOutputReport = {
  canonical_facts: Record<string, unknown>;
  ratios: Record<string, number | null>;
  years_available: number[];
  flag_report?: {
    flags: Array<{
      id: string;
      severity: "critical" | "elevated" | "watch" | "info";
      status: string;
      banker_summary: string;
      banker_detail: string;
    }>;
    critical_count: number;
    elevated_count: number;
  };
  narrative_report?: {
    ratio_narratives: Record<string, string>;
    top_risks: Array<{ title: string; narrative: string; severity?: string }>;
    top_strengths: Array<{ title: string; narrative: string }>;
    resolution_narrative: string;
    final_narrative: string;
  };
  trend_report?: Record<string, unknown>;
  qoe_report?: unknown;
};

type UseSpreadOutputResult = {
  data: SpreadOutputReport | null;
  loading: boolean;
  error: string | null;
  pricingRequired: boolean;
};

export function useSpreadOutput(dealId: string, refreshKey?: number): UseSpreadOutputResult {
  const [data, setData] = useState<SpreadOutputReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pricingRequired, setPricingRequired] = useState(false);

  useEffect(() => {
    if (!dealId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setPricingRequired(false);

    fetch(`/api/deals/${dealId}/spread-output`)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (res.status === 422 && json.error === "pricing_assumptions_required") {
          setPricingRequired(true);
          setData(null);
        } else if (!res.ok) {
          setError(json.error ?? "Failed to load spread output");
        } else {
          setData(json.report ?? null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [dealId, refreshKey]);

  return { data, loading, error, pricingRequired };
}
