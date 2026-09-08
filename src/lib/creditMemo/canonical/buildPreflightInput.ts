/**
 * Extract the deterministic slice memoPreflight checks from a finished memo.
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * Kept separate from the check itself so the check can be tested against
 * hand-built inputs, and so this adapter can be tested against a real memo
 * shape without either file needing to know about the other's internals.
 */

import type { CanonicalCreditMemoV1 } from "./types";
import type { PreflightInput } from "./memoPreflight";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildPreflightInput(
  memo: CanonicalCreditMemoV1,
  contractBlockers: string[] = [],
): PreflightInput {
  const stress = memo.stress_testing;
  const covenantDscr = memo.covenant_package?.financial?.find(
    (c) => c.category === "dscr",
  );

  // The memo's own resolution. Stress testing is the consumer that has always
  // read the governed registry, so its floor is the reference the rest are
  // compared against — when it is absent there is nothing to check against.
  const governedFloor = num(stress?.policy_dscr_floor);

  const revenue = num(memo.financial_analysis.revenue?.value);
  const netIncome = num(memo.financial_analysis.net_income?.value);
  const ebitda = num(memo.financial_analysis.ebitda?.value);
  const totalAssets = num(memo.financial_analysis.balance_sheet_table?.[0]?.total_assets);

  return {
    governedDscrFloor: governedFloor,
    stressPolicyDscrFloor: governedFloor,
    covenantDscrThreshold: num(covenantDscr?.threshold),
    policyExceptions: memo.policy_exceptions.map((p) => p.exception),
    ratioBenchmarkNotes: memo.financial_analysis.ratio_analysis
      .map((r) => r.benchmark_note)
      .filter((n): n is string => typeof n === "string" && n.length > 0),
    governedFields: {
      revenue,
      net_income: netIncome,
      ebitda,
      total_assets: totalAssets,
    },
    // Return on assets is the case the reviewer named: it is Net Income over
    // Assets, and it was being stated as fact on a deal where net income was
    // itself inferred from a margin rather than supplied.
    derivedFigures: memo.financial_analysis.ratio_analysis
      .filter((r) => /return on assets|\broa\b/i.test(r.metric ?? ""))
      .map((r) => ({ label: r.metric, derivedFrom: ["net_income", "total_assets"] })),
    contractBlockers,
  };
}
