import "server-only";

/**
 * Phase 56 — Borrower Report Builder (Orchestrator)
 *
 * Compute ratios → benchmark lookup → health score → Altman Z → persist.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeDSO, computeDIO, computeDPO, computeCCC, computeAssetTurnover } from "@/lib/ratios/efficiencyRatios";
import { computeAltmanZScore } from "@/lib/ratios/altmanZScore";
import { computeHealthScore } from "@/lib/ratios/healthScoring";
import { lookupBenchmarks } from "./benchmarkLookup";
import type { BorrowerHealthReport, BenchmarkComparison, StrengthItem, ImprovementItem } from "./borrowerReportTypes";
import crypto from "node:crypto";

export async function buildBorrowerReport(dealId: string): Promise<BorrowerHealthReport> {
  const sb = supabaseAdmin();

  // Load facts
  const { data: factsRows } = await sb
    .from("deal_financial_facts")
    .select("fact_key, value_num")
    .eq("deal_id", dealId)
    .eq("is_superseded", false);

  const fm: Record<string, number | null> = {};
  for (const r of factsRows ?? []) fm[r.fact_key] = r.value_num ?? null;

  const snapshotHash = crypto.createHash("sha256")
    .update(JSON.stringify(fm, Object.keys(fm).sort()))
    .digest("hex").slice(0, 16);

  // Get NAICS code from deal
  const { data: deal } = await sb.from("deals").select("naics_code").eq("id", dealId).maybeSingle();
  const naicsCode = (deal as any)?.naics_code ?? null;

  // Compute efficiency ratios
  const revenue = fm.TOTAL_REVENUE ?? 0;
  const cogs = fm.COGS ?? (revenue * 0.6); // fallback estimate
  const ar = fm.ACCOUNTS_RECEIVABLE ?? 0;
  const inv = fm.INVENTORY ?? 0;
  const ap = fm.ACCOUNTS_PAYABLE ?? 0;
  const totalAssets = fm.TOTAL_ASSETS ?? 0;

  const dso = computeDSO(ar, revenue);
  const dio = computeDIO(inv, cogs);
  const dpo = computeDPO(ap, cogs);
  const ccc = computeCCC(dso, dio, dpo);
  const assetTurnover = computeAssetTurnover(revenue, totalAssets);

  const grossMargin = revenue > 0 ? ((revenue - cogs) / revenue) : null;
  const netMargin = revenue > 0 && fm.NET_INCOME != null ? fm.NET_INCOME / revenue : null;
  const roa = totalAssets > 0 && fm.NET_INCOME != null ? fm.NET_INCOME / totalAssets : null;
  const currentRatio = fm.CURRENT_RATIO ?? null;
  const debtToEquity = fm.DEBT_TO_EQUITY ?? null;
  const dscr = fm.DSCR ?? null;

  const computedRatios: Record<string, number | null> = {
    gross_margin: grossMargin,
    net_margin: netMargin,
    roa,
    current_ratio: currentRatio,
    debt_to_equity: debtToEquity,
    dscr,
    dso: ar > 0 ? dso : null,
    dio: inv > 0 ? dio : null,
    dpo: ap > 0 ? dpo : null,
    cash_conversion_cycle: (ar > 0 || inv > 0) ? ccc : null,
    asset_turnover: assetTurnover > 0 ? assetTurnover : null,
  };

  // Benchmark lookup
  const benchmarks = await lookupBenchmarks(naicsCode);

  // Build comparisons
  const comparisons: BenchmarkComparison[] = [];
  for (const [metric, value] of Object.entries(computedRatios)) {
    if (value === null) continue;
    const bench = benchmarks.get(metric);
    comparisons.push({
      metricName: metric,
      borrowerValue: value,
      industryMedian: bench?.median_value ?? null,
      percentile25: bench?.percentile_25 ?? null,
      percentile75: bench?.percentile_75 ?? null,
      interpretation: bench?.median_value != null
        ? value >= bench.median_value
          ? `Above industry median (${bench.median_value}).`
          : `Below industry median (${bench.median_value}).`
        : "Industry benchmark not available for this sector.",
    });
  }

  // Health score
  const healthScore = computeHealthScore(
    { grossMargin, netMargin, roa, currentRatio, debtToEquity, dscr, dso: ar > 0 ? dso : null, assetTurnover: assetTurnover > 0 ? assetTurnover : null },
    { grossMargin: benchmarks.get("gross_margin")?.median_value ?? null, dso: benchmarks.get("dso")?.median_value ?? null },
  );

  // Altman Z-Score
  const altman = computeAltmanZScore({
    workingCapital: fm.WORKING_CAPITAL ?? 0,
    totalAssets,
    retainedEarnings: fm.RETAINED_EARNINGS ?? (fm.NET_WORTH ?? 0) * 0.5,
    ebit: fm.NET_INCOME ?? 0, // approximate
    bookValueEquity: fm.NET_WORTH ?? 0,
    totalLiabilities: fm.TOTAL_LIABILITIES ?? 0,
  });

  // Derive strengths / opportunities (deterministic, no LLM for now)
  const strengths: StrengthItem[] = [];
  const opportunities: ImprovementItem[] = [];

  if (grossMargin != null && grossMargin > 0.30) {
    strengths.push({ title: "Strong Gross Margin", detail: `Your gross margin of ${(grossMargin * 100).toFixed(1)}% indicates solid pricing power and cost discipline.`, metric: "gross_margin", value: grossMargin });
  }
  if (dscr != null && dscr >= 1.25) {
    strengths.push({ title: "Healthy Debt Coverage", detail: `Your DSCR of ${dscr.toFixed(2)}x means you generate ${((dscr - 1) * 100).toFixed(0)}% more cash flow than needed to service debt.`, metric: "dscr", value: dscr });
  }
  if (currentRatio != null && currentRatio >= 1.5) {
    strengths.push({ title: "Solid Liquidity Position", detail: `Your current ratio of ${currentRatio.toFixed(2)} indicates adequate short-term liquidity.`, metric: "current_ratio", value: currentRatio });
  }

  if (ar > 0 && dso > 60) {
    const benchDso = benchmarks.get("dso")?.median_value;
    const gap = benchDso ? dso - benchDso : null;
    opportunities.push({
      title: "Reduce Collection Time",
      detail: `Your Days Sales Outstanding of ${dso.toFixed(0)} days means receivables take over two months to collect.`,
      impact: gap != null ? `${gap.toFixed(0)} days above industry median — potential working capital improvement.` : "Faster collections improve working capital.",
      recommendation: "Consider earlier invoicing, automated payment reminders, or tighter credit terms for slow-paying customers.",
    });
  }
  if (debtToEquity != null && debtToEquity > 3.0) {
    opportunities.push({
      title: "Reduce Leverage",
      detail: `Debt-to-equity of ${debtToEquity.toFixed(2)}x is elevated.`,
      impact: "High leverage increases interest costs and financial risk.",
      recommendation: "Focus on debt reduction or equity building through retained earnings.",
    });
  }
  if (netMargin != null && netMargin < 0.05) {
    opportunities.push({
      title: "Improve Profitability",
      detail: `Net margin of ${(netMargin * 100).toFixed(1)}% leaves little cushion for unexpected costs.`,
      impact: "Thin margins increase vulnerability to revenue fluctuations.",
      recommendation: "Review pricing, negotiate supplier terms, or identify cost reduction opportunities.",
    });
  }

  const report: BorrowerHealthReport = {
    dealId,
    generatedAt: new Date().toISOString(),
    naicsCode,
    healthScore,
    computedRatios,
    benchmarkComparisons: comparisons,
    strengths: strengths.slice(0, 3),
    improvementOpportunities: opportunities.slice(0, 5),
    altmanZScore: altman,
    snapshotHash,
  };

  // Persist
  await sb.from("buddy_borrower_reports").insert({
    deal_id: dealId,
    generated_at: report.generatedAt,
    naics_code: naicsCode,
    health_score_composite: healthScore.composite,
    health_score_profitability: healthScore.profitability,
    health_score_liquidity: healthScore.liquidity,
    health_score_leverage: healthScore.leverage,
    health_score_efficiency: healthScore.efficiency,
    computed_ratios: computedRatios as any,
    benchmark_comparisons: comparisons as any,
    strengths: report.strengths as any,
    improvement_opportunities: report.improvementOpportunities as any,
    altman_z_score: altman.score,
    altman_zone: altman.zone,
    snapshot_hash: snapshotHash,
    status: "draft",
  });

  return report;
}
