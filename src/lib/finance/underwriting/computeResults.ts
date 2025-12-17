// src/lib/finance/underwriting/computeResults.ts

import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import type { UnderwritingPolicy } from "./policy";
import { computeDscrTrend } from "./dscrTrend";
import type { UnderwritingResults } from "./results";

function trendDirection(values: Array<{ year: number; value: number | null }>): "up" | "down" | "flat" | "unknown" {
  const pts = values
    .filter((v) => v.value !== null)
    .sort((a, b) => a.year - b.year) as Array<{ year: number; value: number }>;
  if (pts.length < 2) return "unknown";
  const first = pts[0].value;
  const last = pts[pts.length - 1].value;
  const diff = last - first;
  if (Math.abs(diff) < Math.max(1, Math.abs(first) * 0.02)) return "flat";
  return diff > 0 ? "up" : "down";
}

function safeAvg(nums: Array<number>): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function computeUnderwritingResults(
  spreadsByYear: Record<number, TaxSpread>,
  annualDebtService: number | null,
  policy: UnderwritingPolicy
): UnderwritingResults {
  const years = Object.keys(spreadsByYear).map(Number).filter(Number.isFinite).sort((a, b) => a - b);

  const by_year = years.map((y) => {
    const s = spreadsByYear[y];
    return {
      year: y,
      revenue: s.revenue ?? null,
      cfads: s.cfads_proxy ?? s.ebitda ?? null,
      officer_comp: s.officer_comp ?? null,
      ebitda: s.ebitda ?? null,
      dscr: annualDebtService && annualDebtService > 0
        ? ( (s.cfads_proxy ?? s.ebitda ?? null) !== null ? (s.cfads_proxy ?? s.ebitda ?? 0) / annualDebtService : null )
        : null,
      confidence: s.confidence ?? 0,
    };
  });

  const trend = computeDscrTrend(spreadsByYear, annualDebtService);
  const worst_year = trend.worst?.year ?? null;
  const worst_dscr = trend.worst?.dscr ?? null;

  const dscrs = by_year.map((r) => r.dscr).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const avg_dscr = safeAvg(dscrs);

  // Weighted DSCR by revenue (only years with both DSCR and revenue)
  let weighted_dscr: number | null = null;
  {
    let wSum = 0;
    let wTot = 0;
    for (const r of by_year) {
      if (r.dscr === null || r.revenue === null) continue;
      if (!Number.isFinite(r.dscr) || !Number.isFinite(r.revenue)) continue;
      wSum += r.dscr * r.revenue;
      wTot += r.revenue;
    }
    weighted_dscr = wTot > 0 ? wSum / wTot : null;
  }

  // Stress: CFADS - 10%
  let stressed_dscr: number | null = null;
  if (annualDebtService && annualDebtService > 0) {
    const stressed = by_year
      .map((r) => (r.cfads !== null ? (r.cfads * 0.9) / annualDebtService : null))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    stressed_dscr = safeAvg(stressed);
  }

  const low_confidence_years = years.filter((y) => (spreadsByYear[y]?.confidence ?? 0) < policy.min_confidence);

  const cfads_trend = trendDirection(by_year.map((r) => ({ year: r.year, value: r.cfads })));
  const revenue_trend = trendDirection(by_year.map((r) => ({ year: r.year, value: r.revenue })));

  return {
    policy_min_dscr: policy.min_dscr_warning,
    annual_debt_service: annualDebtService,
    worst_year,
    worst_dscr,
    avg_dscr,
    weighted_dscr,
    stressed_dscr,
    cfads_trend,
    revenue_trend,
    flags: trend.flags.slice(0, 12),
    low_confidence_years,
    by_year,
  };
}