import type { IndexRate } from "@/lib/rates/indexRates";

export type ExplainDriver = {
  label: string;
  bps: number; // positive adds to spread
  reason?: string;
  source?: string; // "policy" | "rule" | "missing" | "override"
  ruleId?: string;
  confidence?: number; // 0..1
};

export type Explainability = {
  summary: string;
  drivers: ExplainDriver[];
  missingInputs: { key: string; label: string; impactBps?: number }[];
  confidence: number; // 0..1
  meta: Record<string, unknown>;
};

export type PricingInputs = {
  index_code: "SOFR" | "UST_5Y" | "PRIME";
  loan_amount: number | null;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  spread_override_bps: number | null;
  base_rate_override_pct: number | null;
};

export type PricingQuoteCore = {
  base_rate_pct: number;
  spread_bps: number;
  all_in_rate_pct: number;
  payment_pi_monthly: number | null;
  payment_io_monthly: number | null;
};

/**
 * Deterministic PI payment.
 */
export function computeMonthlyPI(
  principal: number,
  annualRatePct: number,
  amortMonths: number,
): number {
  const r = (annualRatePct / 100) / 12;
  const n = amortMonths;
  if (n <= 0) return 0;
  if (r === 0) return principal / n;
  const denom = 1 - Math.pow(1 + r, -n);
  return denom === 0 ? 0 : (principal * r) / denom;
}

export function computeMonthlyIO(principal: number, annualRatePct: number): number {
  const r = (annualRatePct / 100) / 12;
  return principal * r;
}

/**
 * Build explainability from:
 * - pricing policy outputs (spread components if available)
 * - missing input flags
 * - overrides
 *
 * NOTE:
 * If your computePricing() already returns rule-level/bucket breakdown, use it here.
 * Otherwise this uses best-effort “drivers” based on what the adapter provides.
 */
export function buildExplainability(args: {
  inputs: PricingInputs;
  latestRate: IndexRate;
  quote: PricingQuoteCore;
  policyBreakdown?: any; // optional: pass through from computePricing()
}): Explainability {
  const { inputs, latestRate, quote, policyBreakdown } = args;

  const drivers: ExplainDriver[] = [];

  // Overrides are always explicit drivers
  if (inputs.base_rate_override_pct != null) {
    drivers.push({
      label: "Base rate override",
      bps: 0,
      reason: `Base rate set manually to ${inputs.base_rate_override_pct.toFixed(2)}% (was ${latestRate.ratePct.toFixed(2)}%).`,
      source: "override",
      confidence: 1,
    });
  }

  if (inputs.spread_override_bps != null) {
    drivers.push({
      label: "Spread override",
      bps: 0,
      reason: `Spread set manually to ${inputs.spread_override_bps} bps.`,
      source: "override",
      confidence: 1,
    });
  }

  // If policyBreakdown exists, translate to drivers
  if (policyBreakdown?.drivers?.length) {
    for (const d of policyBreakdown.drivers) {
      drivers.push({
        label: String(d.label ?? d.name ?? "Pricing driver"),
        bps: Number(d.bps ?? d.delta_bps ?? 0),
        reason: d.reason ? String(d.reason) : undefined,
        source: String(d.source ?? "policy"),
        ruleId: d.ruleId ? String(d.ruleId) : undefined,
        confidence: typeof d.confidence === "number" ? d.confidence : undefined,
      });
    }
  } else {
    // Minimal fallback: show spread as one line
    drivers.push({
      label: "Risk-based spread (model)",
      bps: quote.spread_bps,
      reason: "Computed by Buddy’s pricing policy engine from deal risk signals.",
      source: "policy",
      confidence: 0.7,
    });
  }

  // Missing inputs (bank-grade: we explicitly show what would improve accuracy)
  const missingInputs: { key: string; label: string; impactBps?: number }[] = [];
  if (!inputs.loan_amount) missingInputs.push({ key: "loan_amount", label: "Loan amount", impactBps: 0 });
  if (!inputs.term_months) missingInputs.push({ key: "term_months", label: "Term (months)" });
  if (!inputs.amort_months) missingInputs.push({ key: "amort_months", label: "Amortization (months)" });

  // Confidence: simple heuristic (upgrade later)
  const confidence =
    (missingInputs.length === 0 ? 0.9 : missingInputs.length === 1 ? 0.8 : 0.7) *
    (policyBreakdown?.confidence ? Number(policyBreakdown.confidence) : 1);

  const summary = `Base ${inputs.index_code} (${latestRate.ratePct.toFixed(2)}% as of ${latestRate.asOf}) + Spread ${quote.spread_bps} bps = All-in ${quote.all_in_rate_pct.toFixed(2)}%.`;

  return {
    summary,
    drivers,
    missingInputs,
    confidence: Math.max(0, Math.min(1, confidence)),
    meta: {
      index: { code: inputs.index_code, source: latestRate.source, asOf: latestRate.asOf },
      overrides: {
        base_rate_override_pct: inputs.base_rate_override_pct,
        spread_override_bps: inputs.spread_override_bps,
      },
    },
  };
}
