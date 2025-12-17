// src/lib/finance/underwriting/scenarios.ts

export type UnderwritingScenario = {
  name: string;

  // Applies haircut to CFADS proxy before DSCR calc.
  cfads_haircut_pct: number; // e.g. 0.10 = -10%

  // ADS multiplier for "payment shock"
  ads_multiplier: number; // e.g. 1.10 = +10%

  // Optional addback cap for 1120S officer comp
  // If present, officer comp addback is limited to this pct of revenue.
  officer_comp_cap_pct_of_revenue: number | null; // e.g. 0.10 = 10%

  // Optional policy min override for sensitivity
  policy_min_dscr: number; // e.g. 1.25, 1.35, 1.50
};

export const DEFAULT_SCENARIOS: UnderwritingScenario[] = [
  {
    name: "Base (Policy 1.25x)",
    cfads_haircut_pct: 0.0,
    ads_multiplier: 1.0,
    officer_comp_cap_pct_of_revenue: null,
    policy_min_dscr: 1.25,
  },
  {
    name: "Payment Shock (+10% ADS)",
    cfads_haircut_pct: 0.0,
    ads_multiplier: 1.1,
    officer_comp_cap_pct_of_revenue: null,
    policy_min_dscr: 1.25,
  },
  {
    name: "CFADS Haircut (-10%)",
    cfads_haircut_pct: 0.1,
    ads_multiplier: 1.0,
    officer_comp_cap_pct_of_revenue: null,
    policy_min_dscr: 1.25,
  },
  {
    name: "Conservative (ADS +10%, CFADS -10%)",
    cfads_haircut_pct: 0.1,
    ads_multiplier: 1.1,
    officer_comp_cap_pct_of_revenue: null,
    policy_min_dscr: 1.25,
  },
  {
    name: "Tighter Policy (1.35x)",
    cfads_haircut_pct: 0.0,
    ads_multiplier: 1.0,
    officer_comp_cap_pct_of_revenue: null,
    policy_min_dscr: 1.35,
  },
];