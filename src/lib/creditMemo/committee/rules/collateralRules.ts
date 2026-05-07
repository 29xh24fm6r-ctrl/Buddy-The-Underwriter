// Pure collateral rules.

import type { CommitteeObjection, CommitteeRule } from "../types";

const LTV_HARD = 0.85;
const LTV_SOFT = 0.75;
const COVERAGE_HARD = 1.0;
const COVERAGE_SOFT = 1.25;

export const collateralRules: CommitteeRule = (inputs) => {
  const out: CommitteeObjection[] = [];
  const dealId = inputs.dealId;
  const m = inputs.metrics;

  // LTV — uses ltv_gross when available, otherwise computes from loan + gross value.
  let ltv: number | null = null;
  if (m.ltv_gross !== null) {
    ltv = m.ltv_gross;
  } else if (
    m.loan_amount !== null &&
    m.collateral_gross_value !== null &&
    m.collateral_gross_value > 0
  ) {
    ltv = m.loan_amount / m.collateral_gross_value;
  }
  if (ltv !== null) {
    if (ltv > LTV_HARD) {
      out.push({
        code: "collateral_ltv_high",
        domain: "collateral",
        severity: "hard",
        label: `LTV ${(ltv * 100).toFixed(0)}% exceeds ${(LTV_HARD * 100).toFixed(0)}%`,
        rationale: `Loan-to-value of ${(ltv * 100).toFixed(0)}% exceeds the institutional ceiling of ${(LTV_HARD * 100).toFixed(0)}% — committee will require collateral enhancement.`,
        mitigant:
          "Add cross-collateral, require sponsor pledge, or reduce loan amount to a defensible LTV.",
        fixPath: `/deals/${dealId}/memo-inputs#collateral`,
        source: { metric: "ltv", value: ltv, threshold: LTV_HARD },
      });
    } else if (ltv > LTV_SOFT) {
      out.push({
        code: "collateral_ltv_elevated",
        domain: "collateral",
        severity: "soft",
        label: `LTV ${(ltv * 100).toFixed(0)}% is elevated`,
        rationale: `LTV above ${(LTV_SOFT * 100).toFixed(0)}% will draw committee attention to recovery scenarios.`,
        fixPath: `/deals/${dealId}/memo-inputs#collateral`,
        source: { metric: "ltv", value: ltv, threshold: LTV_SOFT },
      });
    }
  }

  // Discounted coverage — committee's preferred lens.
  if (m.collateral_coverage !== null) {
    if (m.collateral_coverage < COVERAGE_HARD) {
      out.push({
        code: "collateral_coverage_below_one",
        domain: "collateral",
        severity: "hard",
        label: `Collateral coverage ${m.collateral_coverage.toFixed(2)}x is below 1.0x`,
        rationale: `Discounted collateral covers ${m.collateral_coverage.toFixed(2)}x of the loan — committee will demand additional security or guaranty.`,
        mitigant:
          "Negotiate higher advance rates against more liquid assets, or add personal/cross guaranty.",
        fixPath: `/deals/${dealId}/memo-inputs#collateral`,
        source: {
          metric: "collateral_coverage",
          value: m.collateral_coverage,
          threshold: COVERAGE_HARD,
        },
      });
    } else if (m.collateral_coverage < COVERAGE_SOFT) {
      out.push({
        code: "collateral_coverage_thin",
        domain: "collateral",
        severity: "soft",
        label: `Collateral coverage ${m.collateral_coverage.toFixed(2)}x is thin`,
        rationale: `Coverage between 1.0x and 1.25x leaves limited cushion — expect committee questions on recovery scenarios.`,
        fixPath: `/deals/${dealId}/memo-inputs#collateral`,
        source: {
          metric: "collateral_coverage",
          value: m.collateral_coverage,
          threshold: COVERAGE_SOFT,
        },
      });
    }
  }

  // No collateral items at all — surface but defer to documentation rule.
  if (
    inputs.memoInput.collateralItemsCount > 0 &&
    inputs.memoInput.collateralWithValueCount === 0
  ) {
    out.push({
      code: "collateral_unvalued",
      domain: "collateral",
      severity: "hard",
      label: `${inputs.memoInput.collateralItemsCount} collateral item(s) lack values`,
      rationale: `Collateral items exist but none carry market or appraised values — committee cannot assess recovery.`,
      fixPath: `/deals/${dealId}/memo-inputs#collateral`,
      source: { metric: "collateralWithValueCount", value: 0 },
    });
  }

  return out;
};
