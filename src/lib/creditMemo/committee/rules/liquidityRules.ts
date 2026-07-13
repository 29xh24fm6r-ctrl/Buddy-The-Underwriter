// Pure liquidity rules.

import type { CommitteeObjection, CommitteeRule } from "../types";

const LIQUIDITY_MONTHS_HARD = 3;   // < 3 months ADS coverage = hard
const LIQUIDITY_MONTHS_SOFT = 6;   // 3-6 months = soft

export const liquidityRules: CommitteeRule = (inputs) => {
  const out: CommitteeObjection[] = [];
  const dealId = inputs.dealId;
  const m = inputs.metrics;

  // Personal liquidity vs annual debt service.
  //
  // NOTE: pfs_total_assets is a total-assets figure, not a true liquid-assets
  // figure (cash/marketable securities) — this pipeline does not currently
  // carry a separate liquid-assets metric. It can include illiquid holdings
  // (real estate, closely-held business interests), so an illiquid sponsor
  // can score as having ample "coverage" here. The rationale text below is
  // phrased as a backstop-capacity proxy rather than confirmed liquidity so
  // a reader doesn't take it as verified cash-on-hand.
  if (m.pfs_total_assets !== null && m.annual_debt_service !== null && m.annual_debt_service > 0) {
    const monthlyDS = m.annual_debt_service / 12;
    if (monthlyDS > 0) {
      const monthsCovered = m.pfs_total_assets / monthlyDS;
      if (monthsCovered < LIQUIDITY_MONTHS_HARD) {
        out.push({
          code: "liquidity_pfs_thin",
          domain: "liquidity",
          severity: "hard",
          label: `Sponsor total-asset backstop covers <${LIQUIDITY_MONTHS_HARD} months of debt service`,
          rationale: `PFS total assets of $${Math.round(m.pfs_total_assets).toLocaleString()} — not all of which may be liquid — cover only ~${monthsCovered.toFixed(1)} months of monthly debt service at face value. Confirm how much of this is actually liquid (cash/marketable securities) rather than real estate or business equity before relying on it as a backstop.`,
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
          label: `Sponsor total-asset backstop covers ${monthsCovered.toFixed(1)} months of debt service`,
          rationale: `PFS total assets provide a modest cushion at face value — confirm how much is actually liquid rather than real estate or business equity before treating it as contingency capital.`,
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
