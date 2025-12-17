// src/lib/finance/underwriting/computeScenarioResults.ts

import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import type { UnderwritingScenario } from "./scenarios";
import { applyScenarioToSpreads } from "./applyScenario";
import { computeUnderwritingResults } from "./computeResults";
import { computeUnderwritingVerdict } from "./computeVerdict";
import type { UnderwritingPolicy } from "./policy";

export type ScenarioResult = {
  scenario: UnderwritingScenario;
  worst_dscr: number | null;
  worst_year: number | null;
  stressed_dscr: number | null;
  verdict_level: "approve" | "caution" | "decline_risk";
  headline: string;
};

export function computeScenarioResults(
  spreadsByYear: Record<number, TaxSpread>,
  annualDebtService: number | null,
  basePolicy: UnderwritingPolicy,
  scenarios: UnderwritingScenario[]
): ScenarioResult[] {
  return scenarios.map((sc) => {
    const adjustedSpreads = applyScenarioToSpreads(spreadsByYear, sc);

    const effectiveAds =
      annualDebtService !== null ? annualDebtService * sc.ads_multiplier : null;

    const policy: UnderwritingPolicy = {
      ...basePolicy,
      min_dscr_warning: sc.policy_min_dscr,
    };

    const results = computeUnderwritingResults(adjustedSpreads, effectiveAds, policy);
    const verdict = computeUnderwritingVerdict(results);

    return {
      scenario: sc,
      worst_dscr: results.worst_dscr,
      worst_year: results.worst_year,
      stressed_dscr: results.stressed_dscr,
      verdict_level: verdict.level,
      headline: verdict.headline,
    };
  });
}