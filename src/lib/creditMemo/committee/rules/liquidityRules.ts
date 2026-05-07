// Pure liquidity rules.

import type { CommitteeObjection, CommitteeRule } from "../types";

const LIQUIDITY_MONTHS_HARD = 3;   // < 3 months ADS coverage = hard
const LIQUIDITY_MONTHS_SOFT = 6;   // 3-6 months = soft

export const liquidityRules: CommitteeRule = (inputs) => {
  const out: CommitteeObjection[] = [];
  const dealId = inputs.dealId;
  const m = inputs.metrics;

  // Personal liquidity vs annual debt service.
  if (m.pfs_total_assets !== null && m.annual_debt_service !== null && m.annual_debt_service > 0) {
    const monthlyDS = m.annual_debt_service / 12;
    if (monthlyDS > 0) {
      const monthsCovered = m.pfs_total_assets / monthlyDS;
      if (monthsCovered < LIQUIDITY_MONTHS_HARD) {
        out.push({
          code: "liquidity_pfs_thin",
          domain: "liquidity",
          severity: "hard",
          label: `Sponsor liquidity covers <${LIQUIDITY_MONTHS_HARD} months of debt service`,
          rationale: `PFS assets of $${Math.round(m.pfs_total_assets).toLocaleString()} cover only ~${monthsCovered.toFixed(1)} months of monthly debt service — committee will press on backstop capacity.`,
          mitigant:
            "Document additional liquidity reserves, line-of-credit availability, or co-guarantor support.",
          fixPath: `/deals/${dealId}/memo-inputs#management`,
          source: {
            metric: "pfs_total_assets",
            value: m.pfs_total_assets,
            threshold: monthlyDS * LIQUIDITY_MONTHS_HARD,
          },
        });
      } else if (monthsCovered < LIQUIDITY_MONTHS_SOFT) {
        out.push({
          code: "liquidity_pfs_modest",
          domain: "liquidity",
          severity: "soft",
          label: `Sponsor liquidity covers ${monthsCovered.toFixed(1)} months of debt service`,
          rationale: `PFS liquidity provides a modest cushion — committee will ask about contingency capital.`,
          fixPath: `/deals/${dealId}/memo-inputs#management`,
          source: {
            metric: "pfs_total_assets",
            value: m.pfs_total_assets,
            threshold: monthlyDS * LIQUIDITY_MONTHS_SOFT,
          },
        });
      }
    }
  }

  // Negative PFS net worth — categorical hard.
  if (m.pfs_net_worth !== null && m.pfs_net_worth < 0) {
    out.push({
      code: "liquidity_pfs_net_worth_negative",
      domain: "liquidity",
      severity: "hard",
      label: `Sponsor PFS net worth is negative ($${Math.round(m.pfs_net_worth).toLocaleString()})`,
      rationale: `PFS net worth below zero materially weakens guarantor support.`,
      mitigant: "Add stronger guarantor or restructure with corporate-only recourse.",
      fixPath: `/deals/${dealId}/memo-inputs#management`,
      source: { metric: "pfs_net_worth", value: m.pfs_net_worth },
    });
  }

  return out;
};
