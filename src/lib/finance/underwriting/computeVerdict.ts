// src/lib/finance/underwriting/computeVerdict.ts

import type { UnderwritingResults } from "./results";
import type { UnderwritingVerdict } from "./verdict";

function hasDownTrend(v: UnderwritingResults["cfads_trend"]): boolean {
  return v === "down";
}

function pushUnique(arr: string[], s: string) {
  if (!arr.includes(s)) arr.push(s);
}

export function computeUnderwritingVerdict(r: UnderwritingResults): UnderwritingVerdict {
  const rationale: string[] = [];
  const drivers: string[] = [];
  const mitigants: string[] = [];

  const policy = r.policy_min_dscr; // 1.25
  const worst = r.worst_dscr;
  const worstYear = r.worst_year;

  // Base validation
  if (r.annual_debt_service === null) {
    return {
      level: "caution",
      headline: "Conclusion pending — Annual Debt Service not provided.",
      rationale: ["Enter Annual Debt Service to finalize DSCR-based policy assessment."],
      key_drivers: ["Missing ADS input"],
      mitigants: [],
    };
  }

  if (worst === null || worstYear === null) {
    return {
      level: "caution",
      headline: "Conclusion pending — Unable to compute worst-year DSCR.",
      rationale: ["CFADS/EBITDA proxy missing in one or more years; verify tax extraction and normalization."],
      key_drivers: ["Missing CFADS/EBITDA proxy"],
      mitigants: ["Manual line-item review and normalization improvements"],
    };
  }

  // Policy logic
  if (worst >= policy) {
    pushUnique(rationale, `Worst-year DSCR of ${worst.toFixed(2)}x (TY ${worstYear}) meets or exceeds policy minimum (${policy.toFixed(2)}x).`);
  } else {
    pushUnique(rationale, `Worst-year DSCR of ${worst.toFixed(2)}x (TY ${worstYear}) is below policy minimum (${policy.toFixed(2)}x).`);
    pushUnique(drivers, "Below-policy worst-year DSCR");
  }

  // Stress case
  if (r.stressed_dscr !== null) {
    if (r.stressed_dscr < policy) {
      pushUnique(rationale, `Stressed DSCR of ${r.stressed_dscr.toFixed(2)}x falls below policy threshold.`);
      pushUnique(drivers, "Stress sensitivity (CFADS -10%)");
    } else {
      pushUnique(mitigants, `Stressed DSCR remains at/above policy (${r.stressed_dscr.toFixed(2)}x).`);
    }
  }

  // Trends
  if (hasDownTrend(r.cfads_trend)) {
    pushUnique(rationale, "CFADS trend is declining across the analyzed period.");
    pushUnique(drivers, "Declining CFADS trend");
  } else if (r.cfads_trend === "up") {
    pushUnique(mitigants, "CFADS trend is improving across the analyzed period.");
  }

  if (r.revenue_trend === "down") {
    pushUnique(drivers, "Declining revenue trend");
  }

  // Data quality
  if (r.low_confidence_years.length) {
    pushUnique(rationale, `Lower-confidence extraction detected in: ${r.low_confidence_years.join(", ")}.`);
    pushUnique(drivers, "Extraction confidence concerns");
    pushUnique(mitigants, "Manual verification of low-confidence years");
  }

  // Material flags (already deduped upstream)
  if (r.flags.length) {
    pushUnique(drivers, `Flags present across years (${Math.min(r.flags.length, 8)} shown).`);
  }

  // Verdict assignment
  // APPROVE: worst >= policy AND (no major negative trend drivers)
  // CAUTION: borderline or missing/low confidence or stress sensitivity or down trends
  // DECLINE_RISK: worst < 1.00 OR (worst materially below policy AND negative trend + stress below policy)
  let level: UnderwritingVerdict["level"] = "caution";

  const materiallyBelowPolicy = worst < policy;
  const failsCoverage = worst < 1.0;

  const stressBelowPolicy = r.stressed_dscr !== null && r.stressed_dscr < policy;
  const negativeTrend = r.cfads_trend === "down" || r.revenue_trend === "down";

  if (!materiallyBelowPolicy && !negativeTrend && !stressBelowPolicy && r.low_confidence_years.length === 0) {
    level = "approve";
  } else if (failsCoverage || (materiallyBelowPolicy && negativeTrend && stressBelowPolicy)) {
    level = "decline_risk";
  } else {
    level = "caution";
  }

  const headline =
    level === "approve"
      ? "Conclusion: Approve — coverage meets policy under current assumptions."
      : level === "decline_risk"
      ? "Conclusion: Decline-Risk — coverage fails policy or stress/trend profile is adverse."
      : "Conclusion: Caution — coverage is borderline or assumptions/data quality require conservatism.";

  // Suggested mitigants (deterministic)
  if (level !== "approve") {
    if (materiallyBelowPolicy) pushUnique(mitigants, "Consider lower loan amount, stronger guarantor support, or additional collateral.");
    if (stressBelowPolicy) pushUnique(mitigants, "Consider tighter structure or require additional liquidity / reserves.");
    if (negativeTrend) pushUnique(mitigants, "Seek explanation for decline; underwrite to stabilized cash flow.");
  }

  return {
    level,
    headline,
    rationale,
    key_drivers: drivers.slice(0, 6),
    mitigants: mitigants.slice(0, 6),
  };
}