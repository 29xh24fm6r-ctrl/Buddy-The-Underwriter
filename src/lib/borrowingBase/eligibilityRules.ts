/**
 * SPEC-BORROWING-BASE-CERTIFICATE-ENGINE-1 (Phase 2) — pure, configurable AR eligibility rule
 * framework for the Borrowing Base Certificate engine.
 *
 * Today the live pipeline (arCollateralProcessor) only disallows accounts that are over-90 or over a
 * concentration limit, marking the WHOLE customer ineligible in either case. This module preserves
 * that behavior exactly (so the BBC ties to borrowing_base_calculations) but expresses it through a
 * rule registry so future policies — affiliate/related-party, foreign, government, contra/credit,
 * disputed, retainage, COD, bankrupt/collection, unapplied credits, malformed rows — can be enabled
 * per bank without rewriting the engine.
 *
 * Pure: no IO, no imports of server-only modules. Whole-customer disallow (not partial) is the
 * default convention to match the existing engine and the standard cross-aging rule.
 */

/** Per-customer ineligible categories. Report-level reasons (stale aging, not-tied-to-GL) live in the quality gates. */
export type IneligibleCategory =
  | "over_90_days"
  | "cross_aged"
  | "concentration"
  | "affiliate_related_party"
  | "foreign"
  | "government"
  | "contra_offset_credit_memo"
  | "disputed"
  | "retainage_progress_billing"
  | "cod_cash_in_advance"
  | "bankrupt_collection"
  | "unapplied_credits"
  | "malformed_or_missing_date";

export const INELIGIBLE_CATEGORY_LABELS: Record<IneligibleCategory, string> = {
  over_90_days: "Over 90 days past due",
  cross_aged: "Cross-aged account (>90 portion disqualifies account)",
  concentration: "Concentration over limit",
  affiliate_related_party: "Affiliate / employee / related party",
  foreign: "Foreign account debtor",
  government: "Government account debtor",
  contra_offset_credit_memo: "Contra / offset / credit memo",
  disputed: "Disputed",
  retainage_progress_billing: "Retainage / progress billing",
  cod_cash_in_advance: "COD / cash in advance",
  bankrupt_collection: "Bankrupt / in collection",
  unapplied_credits: "Unapplied credits",
  malformed_or_missing_date: "Missing invoice date / malformed row",
};

/**
 * Optional per-customer classification signals. Absent/false means "no signal" — a rule only fires
 * when a signal is present AND its category is enabled. The live AR-aging extraction supplies only
 * aging buckets today; these flags are populated by future connectors / banker overrides.
 */
export type CustomerFlags = Partial<{
  affiliate: boolean;
  foreign: boolean;
  government: boolean;
  contra: boolean;
  creditMemo: boolean;
  disputed: boolean;
  retainage: boolean;
  cod: boolean;
  bankrupt: boolean;
  unappliedCredit: boolean;
  missingInvoiceDate: boolean;
}>;

export type EligibilityCustomer = {
  customerName: string;
  total: number;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
  flags?: CustomerFlags;
};

export type EligibilityRuleConfig = {
  /** Categories that are active for this bank. over_90_days + concentration are the live defaults. */
  enabledCategories: IneligibleCategory[];
  /** Single-customer share of gross AR above which the account is concentration-ineligible (0..1). */
  concentrationLimit: number;
  /** Dollar tolerance for over-90 / total comparisons (OCR rounding). */
  tolerance?: number;
};

export const DEFAULT_ENABLED_CATEGORIES: IneligibleCategory[] = ["over_90_days", "cross_aged", "concentration"];

export type CustomerEligibility = {
  customerName: string;
  total: number;
  over90: number;
  concentrationPct: number;
  isIneligible: boolean;
  /** Whole-customer amount disallowed (0 when eligible). */
  ineligibleAmount: number;
  /** All matched reasons, evaluation order. The first is the primary (used for breakdown attribution). */
  reasons: IneligibleCategory[];
};

export type IneligibleBreakdownRow = {
  category: IneligibleCategory;
  label: string;
  amount: number;
  customerCount: number;
};

export type ConcentrationRow = {
  customerName: string;
  amount: number;
  pct: number;
  overLimit: boolean;
};

export type EligibilityResult = {
  grossAr: number;
  eligibleAr: number;
  ineligibleAr: number;
  customers: CustomerEligibility[];
  /** Ineligible dollars attributed to each customer's PRIMARY reason — sums to ineligibleAr. */
  ineligibleBreakdown: IneligibleBreakdownRow[];
  /** Per-customer concentration, descending by amount. */
  concentration: ConcentrationRow[];
};

const num = (v: number | null | undefined): number => (Number.isFinite(v as number) ? Number(v) : 0);

/**
 * Evaluation order = breakdown attribution priority. A customer ineligible for several reasons is
 * counted ONCE, attributed to the first matched reason here.
 */
const RULE_ORDER: IneligibleCategory[] = [
  "malformed_or_missing_date",
  "bankrupt_collection",
  "disputed",
  "contra_offset_credit_memo",
  "unapplied_credits",
  "government",
  "foreign",
  "affiliate_related_party",
  "cod_cash_in_advance",
  "retainage_progress_billing",
  "over_90_days",
  "cross_aged",
  "concentration",
];

/** Apply the configured eligibility rules to a set of AR-aging customer rows. Pure. */
export function applyEligibilityRules(
  customers: EligibilityCustomer[],
  config: EligibilityRuleConfig,
): EligibilityResult {
  const tol = config.tolerance ?? 0.01;
  const enabled = new Set(config.enabledCategories);
  const grossAr = customers.reduce((s, c) => s + num(c.total), 0);

  const evaluated: CustomerEligibility[] = customers.map((c) => {
    const total = num(c.total);
    const over90 = num(c.d90) + num(c.d120);
    const concentrationPct = grossAr > 0 ? total / grossAr : 0;
    const f = c.flags ?? {};
    const reasons: IneligibleCategory[] = [];

    const fires: Partial<Record<IneligibleCategory, boolean>> = {
      malformed_or_missing_date: !Number.isFinite(total) || total <= 0 || f.missingInvoiceDate === true,
      bankrupt_collection: f.bankrupt === true,
      disputed: f.disputed === true,
      contra_offset_credit_memo: f.contra === true || f.creditMemo === true,
      unapplied_credits: f.unappliedCredit === true,
      government: f.government === true,
      foreign: f.foreign === true,
      affiliate_related_party: f.affiliate === true,
      cod_cash_in_advance: f.cod === true,
      retainage_progress_billing: f.retainage === true,
      over_90_days: over90 > tol,
      // Cross-aged: the account carries BOTH a >90 balance AND a not-yet-due (current) balance, so the
      // whole account is disqualified even if the over-90 dollars are small.
      cross_aged: over90 > tol && num(c.current) > tol,
      concentration: concentrationPct > config.concentrationLimit,
    };

    for (const cat of RULE_ORDER) {
      if (enabled.has(cat) && fires[cat]) reasons.push(cat);
    }

    const isIneligible = reasons.length > 0;
    return {
      customerName: c.customerName,
      total,
      over90,
      concentrationPct,
      isIneligible,
      ineligibleAmount: isIneligible ? total : 0,
      reasons,
    };
  });

  const ineligibleAr = evaluated.reduce((s, c) => s + c.ineligibleAmount, 0);
  const eligibleAr = grossAr - ineligibleAr;

  // Breakdown: attribute each ineligible customer's whole balance to its PRIMARY (first) reason.
  const byCat = new Map<IneligibleCategory, { amount: number; customerCount: number }>();
  for (const c of evaluated) {
    if (!c.isIneligible) continue;
    const primary = c.reasons[0];
    const agg = byCat.get(primary) ?? { amount: 0, customerCount: 0 };
    agg.amount += c.ineligibleAmount;
    agg.customerCount += 1;
    byCat.set(primary, agg);
  }
  const ineligibleBreakdown: IneligibleBreakdownRow[] = RULE_ORDER.filter((cat) => byCat.has(cat)).map((cat) => ({
    category: cat,
    label: INELIGIBLE_CATEGORY_LABELS[cat],
    amount: byCat.get(cat)!.amount,
    customerCount: byCat.get(cat)!.customerCount,
  }));

  const concentration: ConcentrationRow[] = evaluated
    .map((c) => ({
      customerName: c.customerName,
      amount: c.total,
      pct: c.concentrationPct,
      overLimit: c.concentrationPct > config.concentrationLimit,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { grossAr, eligibleAr, ineligibleAr, customers: evaluated, ineligibleBreakdown, concentration };
}
