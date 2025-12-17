// src/lib/finance/underwriting/applyScenario.ts

import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import type { UnderwritingScenario } from "./scenarios";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function applyScenarioToSpreads(
  spreadsByYear: Record<number, TaxSpread>,
  scenario: UnderwritingScenario
): Record<number, TaxSpread> {
  const out: Record<number, TaxSpread> = {};

  for (const k of Object.keys(spreadsByYear)) {
    const year = Number(k);
    const s = spreadsByYear[year];
    if (!s) continue;

    const revenue = s.revenue ?? null;
    const officerComp = s.officer_comp ?? null;

    // Start from CFADS proxy (or EBITDA fallback)
    let cfads = s.cfads_proxy ?? s.ebitda ?? null;

    // Optional: cap officer comp addback by % of revenue
    // This only matters if your cfads_proxy includes officer comp addback.
    // If your cfads_proxy already bakes it in, we apply a conservative reduction
    // when officer comp is "too large" relative to revenue.
    if (
      cfads !== null &&
      revenue !== null &&
      officerComp !== null &&
      scenario.officer_comp_cap_pct_of_revenue !== null
    ) {
      const cap = clamp(scenario.officer_comp_cap_pct_of_revenue, 0, 1) * revenue;
      if (officerComp > cap) {
        const excess = officerComp - cap;
        // Reduce CFADS by the excess addback above cap
        cfads = cfads - excess;
      }
    }

    // Apply CFADS haircut
    if (cfads !== null) {
      cfads = cfads * (1 - clamp(scenario.cfads_haircut_pct, 0, 0.9));
    }

    out[year] = {
      ...s,
      // store scenario-adjusted cfads proxy
      cfads_proxy: cfads,
    };
  }

  return out;
}