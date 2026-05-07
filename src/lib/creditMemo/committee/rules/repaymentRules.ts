// Pure repayment / cash-flow rules for the committee anticipation engine.

import type { CommitteeObjection, CommitteeRule } from "../types";

const DSCR_HARD_THRESHOLD = 1.25;
const DSCR_SOFT_THRESHOLD = 1.4;
const STRESSED_DSCR_HARD_THRESHOLD = 1.0;
const STRESSED_DSCR_SOFT_THRESHOLD = 1.1;
const GCF_DSCR_HARD_THRESHOLD = 1.1;

export const repaymentRules: CommitteeRule = (inputs) => {
  const out: CommitteeObjection[] = [];
  const dealId = inputs.dealId;
  const m = inputs.metrics;

  if (m.dscr !== null && m.dscr < DSCR_HARD_THRESHOLD) {
    out.push({
      code: "repayment_dscr_below_hard_threshold",
      domain: "repayment",
      severity: "hard",
      label: `DSCR ${m.dscr.toFixed(2)}x is below ${DSCR_HARD_THRESHOLD}x`,
      rationale: `Primary cash flow coverage of ${m.dscr.toFixed(2)}x falls under the institutional minimum of ${DSCR_HARD_THRESHOLD}x.`,
      mitigant:
        "Consider amortization extension, sponsor support, or a structured guarantee.",
      fixPath: `/deals/${dealId}/spreads`,
      source: { metric: "dscr", value: m.dscr, threshold: DSCR_HARD_THRESHOLD },
    });
  } else if (m.dscr !== null && m.dscr < DSCR_SOFT_THRESHOLD) {
    out.push({
      code: "repayment_dscr_thin",
      domain: "repayment",
      severity: "soft",
      label: `DSCR ${m.dscr.toFixed(2)}x is thin`,
      rationale: `Coverage of ${m.dscr.toFixed(2)}x is workable but committee will probe for sustainability.`,
      mitigant:
        "Highlight contracted revenue, recurring billing, or defensive industry posture.",
      fixPath: `/deals/${dealId}/spreads`,
      source: { metric: "dscr", value: m.dscr, threshold: DSCR_SOFT_THRESHOLD },
    });
  }

  if (
    m.dscr_stressed_300bps !== null &&
    m.dscr_stressed_300bps < STRESSED_DSCR_HARD_THRESHOLD
  ) {
    out.push({
      code: "repayment_stressed_dscr_breaks_one",
      domain: "repayment",
      severity: "hard",
      label: `Stressed DSCR ${m.dscr_stressed_300bps.toFixed(2)}x breaks 1.0x`,
      rationale: `+300bps rate shock pulls coverage to ${m.dscr_stressed_300bps.toFixed(
        2,
      )}x — committee will treat this as repayment failure under stress.`,
      mitigant:
        "Propose rate cap, fixed-rate structure, or shortened amortization to absorb shock.",
      fixPath: `/deals/${dealId}/pricing`,
      source: {
        metric: "dscr_stressed_300bps",
        value: m.dscr_stressed_300bps,
        threshold: STRESSED_DSCR_HARD_THRESHOLD,
      },
    });
  } else if (
    m.dscr_stressed_300bps !== null &&
    m.dscr_stressed_300bps < STRESSED_DSCR_SOFT_THRESHOLD
  ) {
    out.push({
      code: "repayment_stressed_dscr_thin",
      domain: "repayment",
      severity: "soft",
      label: `Stressed DSCR ${m.dscr_stressed_300bps.toFixed(2)}x is tight under +300bps`,
      rationale: `Stressed coverage of ${m.dscr_stressed_300bps.toFixed(2)}x narrows the cushion above 1.0x.`,
      mitigant: "Cite rate hedge, prepayment optionality, or fixed-rate election.",
      fixPath: `/deals/${dealId}/pricing`,
      source: {
        metric: "dscr_stressed_300bps",
        value: m.dscr_stressed_300bps,
        threshold: STRESSED_DSCR_SOFT_THRESHOLD,
      },
    });
  }

  if (m.gcf_dscr !== null && m.gcf_dscr < GCF_DSCR_HARD_THRESHOLD) {
    out.push({
      code: "repayment_gcf_dscr_tight",
      domain: "repayment",
      severity: "hard",
      label: `Global cash flow DSCR ${m.gcf_dscr.toFixed(2)}x is tight`,
      rationale: `Cross-entity GCF coverage of ${m.gcf_dscr.toFixed(2)}x is below the ${GCF_DSCR_HARD_THRESHOLD}x committee floor for global support.`,
      mitigant:
        "Document personal liquidity backing or supplemental income streams from sponsor.",
      fixPath: `/deals/${dealId}/spreads`,
      source: {
        metric: "gcf_dscr",
        value: m.gcf_dscr,
        threshold: GCF_DSCR_HARD_THRESHOLD,
      },
    });
  }

  if (
    m.excess_cash_flow !== null &&
    m.excess_cash_flow < 0 &&
    m.cash_flow_available !== null
  ) {
    out.push({
      code: "repayment_excess_cash_flow_negative",
      domain: "repayment",
      severity: "hard",
      label: `Excess cash flow is negative ($${Math.round(m.excess_cash_flow).toLocaleString()})`,
      rationale: `Cash flow available net of debt service is negative — borrower cannot self-fund the proposed structure as priced.`,
      mitigant:
        "Re-price for lower payment, extend amortization, or require sponsor cash equity.",
      fixPath: `/deals/${dealId}/pricing`,
      source: { metric: "excess_cash_flow", value: m.excess_cash_flow },
    });
  }

  return out;
};
