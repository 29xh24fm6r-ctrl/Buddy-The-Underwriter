// Pure leverage rules.

import type { CommitteeObjection, CommitteeRule } from "../types";

const DEBT_TO_EBITDA_HARD = 4.0;
const DEBT_TO_EBITDA_SOFT = 3.0;
const DEBT_TO_EQUITY_HARD = 4.0;

export const leverageRules: CommitteeRule = (inputs) => {
  const out: CommitteeObjection[] = [];
  const dealId = inputs.dealId;
  const m = inputs.metrics;

  // Debt / EBITDA — preferred leverage measure when EBITDA available.
  if (m.total_liabilities !== null && m.ebitda_ttm !== null && m.ebitda_ttm > 0) {
    const ratio = m.total_liabilities / m.ebitda_ttm;
    if (ratio > DEBT_TO_EBITDA_HARD) {
      out.push({
        code: "leverage_debt_ebitda_high",
        domain: "leverage",
        severity: "hard",
        label: `Leverage ${ratio.toFixed(1)}x debt/EBITDA exceeds ${DEBT_TO_EBITDA_HARD}x`,
        rationale: `Total liabilities of $${Math.round(m.total_liabilities).toLocaleString()} on EBITDA of $${Math.round(m.ebitda_ttm).toLocaleString()} produces ${ratio.toFixed(1)}x — committee will challenge sustainability.`,
        mitigant:
          "Document deleveraging path, asset sales, or sponsor equity injection.",
        fixPath: `/deals/${dealId}/spreads`,
        source: {
          metric: "debt_to_ebitda",
          value: ratio,
          threshold: DEBT_TO_EBITDA_HARD,
        },
      });
    } else if (ratio > DEBT_TO_EBITDA_SOFT) {
      out.push({
        code: "leverage_debt_ebitda_elevated",
        domain: "leverage",
        severity: "soft",
        label: `Leverage ${ratio.toFixed(1)}x debt/EBITDA is elevated`,
        rationale: `Coverage of ${ratio.toFixed(1)}x debt/EBITDA is workable but committee will probe the trajectory.`,
        fixPath: `/deals/${dealId}/spreads`,
        source: {
          metric: "debt_to_ebitda",
          value: ratio,
          threshold: DEBT_TO_EBITDA_SOFT,
        },
      });
    }
  }

  // Debt / equity — fallback when EBITDA unavailable.
  if (
    m.debt_to_equity !== null &&
    m.debt_to_equity > DEBT_TO_EQUITY_HARD &&
    !out.some((o) => o.domain === "leverage" && o.severity === "hard")
  ) {
    out.push({
      code: "leverage_debt_equity_high",
      domain: "leverage",
      severity: "hard",
      label: `Debt-to-equity ${m.debt_to_equity.toFixed(1)}x is high`,
      rationale: `Capital structure heavily debt-weighted at ${m.debt_to_equity.toFixed(1)}x — committee will probe equity support.`,
      mitigant: "Highlight subordinated debt or owner equity at risk.",
      fixPath: `/deals/${dealId}/spreads`,
      source: {
        metric: "debt_to_equity",
        value: m.debt_to_equity,
        threshold: DEBT_TO_EQUITY_HARD,
      },
    });
  }

  return out;
};
