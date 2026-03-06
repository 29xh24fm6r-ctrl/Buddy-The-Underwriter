/**
 * Narrative Templates — Assertion → Number → Context → Implication
 *
 * All variables in {curly_braces} must be substituted before use.
 * The narrativeComposer is responsible for substitution.
 * Pure data — no DB, no server imports.
 */

// ---------------------------------------------------------------------------
// Template type
// ---------------------------------------------------------------------------

export interface NarrativeTemplate {
  condition: string;
  template: string;
  severity: "positive" | "neutral" | "caution" | "concern" | "critical";
}

// ---------------------------------------------------------------------------
// Coverage Narratives
// ---------------------------------------------------------------------------

export const COVERAGE_NARRATIVES: Record<string, NarrativeTemplate> = {
  dscr_strong: {
    condition: "DSCR >= 1.50",
    template:
      "Business cash flow provides strong debt service coverage. At {dscr}x, the borrower generates {cushion} of annual cash flow above debt obligations — a cushion that would absorb a {stress_pct}% revenue decline before coverage fell below 1.0x.",
    severity: "positive",
  },
  dscr_adequate: {
    condition: "1.25 <= DSCR < 1.50",
    template:
      "Coverage is adequate but below the industry peer median of {peer_median}x for {naics_description}. The {cushion} annual cushion above debt service provides limited buffer; a {stress_pct}% revenue decline would breach 1.0x coverage.",
    severity: "neutral",
  },
  dscr_marginal: {
    condition: "1.10 <= DSCR < 1.25",
    template:
      "Coverage is marginal at {dscr}x, passing the {policy_min}x policy minimum by {cushion} annually. Any revenue softness or cost increase could push coverage below policy minimums. Recommend covenant protection at {covenant_threshold}x tested {frequency}.",
    severity: "caution",
  },
  dscr_insufficient: {
    condition: "DSCR < 1.10",
    template:
      "Business cash flow does not cover proposed debt service on a standalone basis ({dscr}x). Global cash flow analysis {global_resolution}.",
    severity: "critical",
  },
};

// ---------------------------------------------------------------------------
// Leverage Narratives
// ---------------------------------------------------------------------------

export const LEVERAGE_NARRATIVES: Record<string, NarrativeTemplate> = {
  leverage_elevated_declining: {
    condition: "Debt/EBITDA > policy_max AND prior > current",
    template:
      "Total leverage is elevated at {debt_ebitda}x Debt/EBITDA but has improved from {prior_debt_ebitda}x in the prior year. At the current deleveraging pace, the borrower reaches the {target}x target in approximately {years} years.",
    severity: "caution",
  },
  leverage_elevated_stable: {
    condition: "Debt/EBITDA > policy_max AND stable",
    template:
      "Debt/EBITDA of {debt_ebitda}x is elevated relative to the industry median of {peer_median}x for {naics_description} ({percentile}th percentile). Leverage has been flat for {years} years — deleveraging is not occurring organically.",
    severity: "concern",
  },
  leverage_elevated_increasing: {
    condition: "Debt/EBITDA > policy_max AND increasing",
    template:
      "Leverage has increased from {prior_debt_ebitda}x to {current_debt_ebitda}x over {years} years — a concerning trend. If this continues, the borrower will reach {warning_threshold}x in approximately {projection_years} years.",
    severity: "critical",
  },
};

// ---------------------------------------------------------------------------
// Working Capital Narratives
// ---------------------------------------------------------------------------

export const WORKING_CAPITAL_NARRATIVES: Record<string, NarrativeTemplate> = {
  dso_elevated: {
    condition: "DSO above p75",
    template:
      "Days sales outstanding of {dso} days is at the {percentile}th percentile for {naics_description} (industry median: {peer_median} days). The elevated DSO has {ar_impact} of additional working capital tied up in receivables versus the prior year.",
    severity: "caution",
  },
  dso_deteriorating: {
    condition: "DSO increasing YoY",
    template:
      "Days sales outstanding has increased {delta} days year-over-year to {current_dso} days, suggesting slower customer payments or a shift to longer credit terms. This has absorbed {ar_impact} of working capital that was previously available for operations.",
    severity: "concern",
  },
  ccc_elevated: {
    condition: "CCC above p75",
    template:
      "The cash conversion cycle of {ccc} days means the business ties up working capital for {ccc} days between spending on inventory/labor and collecting from customers. The industry median is {peer_median} days — the {delta} day gap represents approximately {capital_trapped} of additional working capital requirement.",
    severity: "caution",
  },
};

// ---------------------------------------------------------------------------
// QoE Narratives
// ---------------------------------------------------------------------------

export const QOE_NARRATIVES: Record<string, NarrativeTemplate> = {
  qoe_material: {
    condition: "QoE adjustment total > 5% of EBITDA",
    template:
      "Reported EBITDA of {reported} includes {adjustment} of non-recurring {description}. Normalized EBITDA of {normalized} is the appropriate basis for coverage analysis — using reported figures would overstate coverage by {overstatement_pct}%.",
    severity: "caution",
  },
  qoe_clean: {
    condition: "No material QoE adjustments",
    template:
      "Quality of earnings analysis identified no material non-recurring items. Reported EBITDA of {ebitda} reflects recurring operating performance.",
    severity: "positive",
  },
};

// ---------------------------------------------------------------------------
// Trend Narratives
// ---------------------------------------------------------------------------

export const TREND_NARRATIVES: Record<string, NarrativeTemplate> = {
  margin_compressing: {
    condition: "EBITDA margin declining",
    template:
      "EBITDA margin has compressed from {prior_margin}% to {current_margin}% over {years} years — a {bps}bps reduction. {cause_hypothesis} If compression continues at this pace, coverage will fall below {threshold}x in approximately {projection_months} months.",
    severity: "concern",
  },
  revenue_declining: {
    condition: "Revenue declining 2+ years",
    template:
      "Revenue has declined {pct}% over {years} years from {peak} to {current}. {context} The current DSCR assumes revenue stabilizes at current levels — a further {stress_pct}% decline would reduce coverage to {stressed_dscr}x.",
    severity: "concern",
  },
};

// ---------------------------------------------------------------------------
// Global / Consolidation Narratives
// ---------------------------------------------------------------------------

export const GLOBAL_NARRATIVES: Record<string, NarrativeTemplate> = {
  global_resolves_standalone: {
    condition: "Standalone DSCR < policy AND global DSCR >= policy",
    template:
      "The standalone C&I analysis shows {standalone_dscr}x coverage, which {standalone_assessment}. When {entity_description} is consolidated, the enterprise generates {global_dscr}x global DSCR — the consolidated view is the appropriate basis for credit analysis.",
    severity: "neutral",
  },
  global_insufficient: {
    condition: "Both standalone and global DSCR < policy",
    template:
      "Neither the standalone ({standalone_dscr}x) nor the global ({global_dscr}x) analysis provides adequate coverage. The deal requires either additional equity, reduced loan amount, or additional income documentation.",
    severity: "critical",
  },
};

// ---------------------------------------------------------------------------
// Strength Narratives
// ---------------------------------------------------------------------------

export const STRENGTH_NARRATIVES: Record<string, NarrativeTemplate> = {
  strong_liquidity: {
    condition: "Current ratio >= p75",
    template:
      "Liquidity is strong. The current ratio of {current_ratio}x ({percentile}th percentile for {naics_description}) represents {working_capital} of net working capital — {months} months of operating expenses covered by liquid assets.",
    severity: "positive",
  },
  long_operating_history: {
    condition: "Years in business >= 5",
    template:
      "The business has {years} years of operating history, providing confidence in management's ability to navigate business cycles. Revenue has been positive in all {years} years of available data.",
    severity: "positive",
  },
  clean_qoe: {
    condition: "No material QoE adjustments",
    template:
      "Quality of earnings is clean — all EBITDA is from recurring operations with no material non-recurring adjustments required. The {ebitda} normalized EBITDA is a reliable indicator of earning power.",
    severity: "positive",
  },
};
