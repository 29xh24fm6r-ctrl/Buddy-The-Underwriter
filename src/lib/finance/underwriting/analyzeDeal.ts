// src/lib/finance/underwriting/analyzeDeal.ts

import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import type { UnderwritingPolicy } from "./policy";
import { computeDscrTrend } from "./dscrTrend";

export type UnderwritingSummary = {
  overall: "green" | "amber" | "red";
  headline: string;
  bullets: string[];
  worstYear: number | null;
  worstDscr: number | null;
};

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

export function analyzeUnderwriting(
  spreadsByYear: Record<number, TaxSpread>,
  annualDebtService: number | null,
  policy: UnderwritingPolicy
): UnderwritingSummary {
  const years = Object.keys(spreadsByYear).map(Number).filter(Number.isFinite);
  if (!years.length) {
    return {
      overall: "amber",
      headline: "No tax year spreads available yet.",
      bullets: ["Run OCR on at least one tax return to generate spreads."],
      worstYear: null,
      worstDscr: null,
    };
  }

  const trend = computeDscrTrend(spreadsByYear, annualDebtService);
  const worst = trend.worst;

  const bullets: string[] = [];

  // Confidence warnings
  const lowConfYears = years
    .filter((y) => (spreadsByYear[y]?.confidence ?? 0) < policy.min_confidence)
    .sort((a, b) => a - b);
  if (lowConfYears.length) {
    bullets.push(`Low confidence extraction in: ${lowConfYears.join(", ")} (verify line items).`);
  }

  // DSCR assessment
  let overall: "green" | "amber" | "red" = "amber";
  let headline = "DSCR analysis incomplete (missing Annual Debt Service).";

  if (annualDebtService === null) {
    bullets.push("Enter Annual Debt Service to compute DSCR across years.");
    if (trend.flags.length) bullets.push(`Flags: ${trend.flags.slice(0, 6).join(" • ")}`);
    return { overall, headline, bullets, worstYear: worst?.year ?? null, worstDscr: worst?.dscr ?? null };
  }

  if (!worst || worst.dscr === null) {
    headline = "Unable to compute DSCR (missing CFADS/EBITDA).";
    bullets.push("CFADS proxy is missing; ensure 1120S normalization is detecting OBI, depreciation, and interest.");
    if (trend.flags.length) bullets.push(`Flags: ${trend.flags.slice(0, 6).join(" • ")}`);
    return { overall, headline, bullets, worstYear: null, worstDscr: null };
  }

  const w = worst.dscr;
  const worstYear = worst.year ?? null;

  if (w < policy.min_dscr_hard) overall = "red";
  else if (w < policy.min_dscr_warning) overall = "amber";
  else overall = "green";

  headline =
    overall === "green"
      ? `Meets 1.25x DSCR policy minimum. Worst year ${w.toFixed(2)}x (TY ${worstYear}).`
      : overall === "amber"
      ? `Below 1.25x policy minimum but covers debt. Worst year ${w.toFixed(2)}x (TY ${worstYear}).`
      : `Fails to cover annual debt service. Worst year ${w.toFixed(2)}x (TY ${worstYear}).`;

  // CFADS trend direction
  const cfadsTrend = trendDirection(
    years.map((y) => ({ year: y, value: spreadsByYear[y]?.cfads_proxy ?? null }))
  );
  if (cfadsTrend !== "unknown") {
    bullets.push(`CFADS trend: ${cfadsTrend.toUpperCase()}.`);
  }

  // Revenue trend direction
  const revTrend = trendDirection(years.map((y) => ({ year: y, value: spreadsByYear[y]?.revenue ?? null })));
  if (revTrend !== "unknown") {
    bullets.push(`Revenue trend: ${revTrend.toUpperCase()}.`);
  }

  // Surface key flags (deduped-ish already)
  if (trend.flags.length) {
    bullets.push(`Flags across years: ${trend.flags.slice(0, 8).join(" • ")}`);
  }

  return {
    overall,
    headline,
    bullets,
    worstYear,
    worstDscr: w,
  };
}