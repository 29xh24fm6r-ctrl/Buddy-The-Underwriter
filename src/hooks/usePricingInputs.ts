"use client";

import { useEffect, useState } from "react";

export type PricingInputs = {
  index_code: "SOFR" | "UST_5Y" | "PRIME" | null;
  base_rate_override_pct: number | null;
  spread_override_bps: number | null;
  loan_amount: number | null;
  term_months: number | null;
  amort_months: number | null;
  interest_only_months: number | null;
};

export function usePricingInputs(dealId: string) {
  const [data, setData] = useState<PricingInputs | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dealId) return;
    let cancelled = false;
    fetch(`/api/deals/${dealId}/pricing/inputs`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json?.inputs ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  return { data, loading };
}
