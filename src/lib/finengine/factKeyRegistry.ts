/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 1
 *
 * Frozen canonical factKey vocabulary + a NON-THROWING classifier.
 *
 * The spec asks for registry-validated fact keys that reject unknowns at write
 * time. A hard reject would, today, break live extraction facts (TOTAL_INCOME,
 * M1_*, SL_*, F1125A_* …) that are not canonical metrics — so Phase 1 ships the
 * vocabulary in REPORT-ONLY mode: `classifyFactKey` labels a key as a canonical
 * metric, a known extraction key, or unknown, without changing any write
 * behavior. Hard rejection is wired only once the vocabulary is complete (later
 * phase), preserving the additive-before-subtractive invariant.
 *
 * Standalone (no import of server-only `keys.ts`) so it is unit-testable under
 * `node --test --import tsx`. Mirrors the `fact_key` strings in
 * `src/lib/financialFacts/keys.ts::CANONICAL_FACTS`; keep in sync when that
 * grows (a Phase 6 guard reconciles the two under the react-server condition).
 */

export type FactKeyClass = "canonical_metric" | "extraction" | "unknown";

/**
 * Canonical METRIC fact keys the engine computes and owns. Mirrors the
 * `fact_key` values of CANONICAL_FACTS plus the Phase 4 metric library keys.
 */
export const CANONICAL_METRIC_KEYS: ReadonlySet<string> = new Set([
  // Repayment capacity / debt service
  "CASH_FLOW_AVAILABLE",
  "CF_NCADS",
  "ANNUAL_DEBT_SERVICE",
  "ANNUAL_DEBT_SERVICE_PROPOSED",
  "ANNUAL_DEBT_SERVICE_EXISTING",
  "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
  "EXCESS_CASH_FLOW",
  "PROPOSED_LOAN_COVERAGE",
  // DSCR family
  "DSCR",
  "DSCR_STRESSED_300BPS",
  "GCF_DSCR",
  // Global cash flow
  "GLOBAL_CASH_FLOW",
  "GCF_GLOBAL_CASH_FLOW",
  // Income statement
  "REVENUE",
  "COGS",
  "GROSS_PROFIT",
  "EBITDA",
  "OFFICER_COMP_EXCESS_ADDBACK",
  "NET_INCOME",
  // Collateral
  "COLLATERAL_GROSS_VALUE",
  "COLLATERAL_NET_VALUE",
  "COLLATERAL_DISCOUNTED_VALUE",
  "COLLATERAL_DISCOUNTED_COVERAGE",
  "COLLATERAL_COVERAGE_RATIO",
  "LTV_GROSS",
  "LTV_NET",
  // Sources & uses
  "TOTAL_PROJECT_COST",
  "BORROWER_EQUITY",
  "BORROWER_EQUITY_PCT",
  "BANK_LOAN_TOTAL",
  "EQUITY_INJECTION",
  "EQUITY_INJECTION_PCT",
  // Balance sheet
  "TOTAL_ASSETS",
  "TOTAL_LIABILITIES",
  "NET_WORTH",
  "WORKING_CAPITAL",
  "CURRENT_RATIO",
  "DEBT_TO_EQUITY",
  // CRE / property
  "NOI_TTM",
  "TOTAL_INCOME_TTM",
  "OPEX_TTM",
  "IN_PLACE_RENT_MO",
  "OCCUPANCY_PCT",
  "VACANCY_PCT",
  // Personal income / PFS / GCF
  "PERSONAL_TOTAL_INCOME",
  "PFS_TOTAL_ASSETS",
  "PFS_TOTAL_LIABILITIES",
  "PFS_NET_WORTH",
  // AR / borrowing base
  "AR_TOTAL",
  "AR_ELIGIBLE",
  "AR_INELIGIBLE",
  "AR_ADVANCE_RATE",
  "AR_BORROWING_BASE_VALUE",
  "AR_BORROWING_BASE_AVAILABILITY",
  // Phase 4 metric library additions (computed, owned by the core)
  "FCCR",
  "ICR",
  "LEVERAGE_TOTAL",
  "LEVERAGE_SENIOR",
  "DEBT_YIELD",
  "CAP_RATE",
  "DEBT_TO_TANGIBLE_NET_WORTH",
  "QUICK_RATIO",
]);

/**
 * Known extraction fact-key PREFIXES/keys — source-line and raw extraction
 * facts that are legitimate but are NOT canonical metrics. Used to classify
 * (not own) them.
 */
const EXTRACTION_KEY_PREFIXES = [
  "SL_", // source-line facts (SL_CASH, SL_AR_GROSS, SL_RETAINED_EARNINGS …)
  "M1_", // Schedule M-1 book/tax bridge
  "F1125A_", // Form 1125-A COGS schedule
  "PTR_", // personal tax return detection
  "PFS_", // personal financial statement detail (beyond the canonical PFS_* metrics)
  "K1_", // K-1 detail
];

const KNOWN_EXTRACTION_KEYS: ReadonlySet<string> = new Set([
  "ORDINARY_BUSINESS_INCOME",
  "TAXABLE_INCOME",
  "TOTAL_INCOME",
  "GROSS_RECEIPTS",
  "RETURNS_ALLOWANCES",
  "NET_SALES_REVENUE",
  "INTEREST_EXPENSE",
  "DEPRECIATION",
  "AMORTIZATION",
  "SECTION_179_EXPENSE",
  "BONUS_DEPRECIATION",
  "GUARANTEED_PAYMENTS",
  "OFFICER_COMPENSATION",
  "NON_RECURRING_EXPENSE",
  "NON_RECURRING_INCOME",
  "COST_OF_GOODS_SOLD",
  "WAGES_W2",
  "TOTAL_TAX",
]);

/**
 * SPEC-FINENGINE-CANONICAL-FACT-BRIDGE-1 — the ONE canonical map from
 * extraction-level fact keys to the metric/model-level keys the financial model
 * (buildFinancialModel) and spread templates (renderStandardSpread) expect.
 * Every consumer normalizes through `normalizeFactKey` — no separate alias maps.
 *
 * Direction: extractor-written key → canonical metric/model key.
 * Keys already canonical (TOTAL_REVENUE, COST_OF_GOODS_SOLD) are NOT listed here;
 * they pass through `normalizeFactKey` unchanged.
 *
 * INVARIANT (guarded by factKeyNormalization.test.ts): every RHS value is a real
 * downstream slot — a canonical metric key, a BALANCE_MAP key, or an
 * INCOME_PRIORITY key. A target with no slot is dead vocabulary and is rejected.
 * A source-line key gains an entry here only once a model slot exists for it;
 * unmapped keys pass through `normalizeFactKey` unchanged.
 */
export const EXTRACTION_TO_CANONICAL: Record<string, string> = {
  // ── Balance Sheet (SL_ source-line → BALANCE_MAP canonical) ──────────────
  SL_CASH:                          "CASH_AND_EQUIVALENTS",
  SL_AR_GROSS:                      "ACCOUNTS_RECEIVABLE",
  SL_INVENTORY:                     "INVENTORY",
  SL_OTHER_CURRENT_ASSETS:          "OTHER_CURRENT_ASSETS",
  SL_TOTAL_CURRENT_ASSETS:          "TOTAL_CURRENT_ASSETS",
  SL_TOTAL_ASSETS:                  "TOTAL_ASSETS",
  SL_ACCOUNTS_PAYABLE:              "ACCOUNTS_PAYABLE",
  SL_OPERATING_CURRENT_LIABILITIES: "OTHER_CURRENT_LIABILITIES",
  SL_TOTAL_CURRENT_LIABILITIES:     "TOTAL_CURRENT_LIABILITIES",
  SL_TOTAL_LIABILITIES:             "TOTAL_LIABILITIES",
  SL_TOTAL_EQUITY:                  "TOTAL_EQUITY",
  SL_RETAINED_EARNINGS:             "RETAINED_EARNINGS",
  SL_COMMON_STOCK:                  "COMMON_STOCK",
  SL_PAID_IN_CAPITAL:               "PAID_IN_CAPITAL",

  // ── Liability classification (Schedule L lines 17-21) ────────────────────
  // SPEC-FINENGINE-EXTRACTION-RECONCILIATION-1. Loans-from-shareholders (L19)
  // and mortgages/notes ≥1yr (L20) are non-current debt; wages payable is an
  // accrued liability. When two keys both resolve to LONG_TERM_DEBT for one
  // period, buildFinancialModel sums DISTINCT values and de-dupes identical
  // ones (same loan reported on two Schedule L lines).
  SL_LOANS_FROM_SHAREHOLDERS:       "LONG_TERM_DEBT",
  SL_MORTGAGES_NOTES_BONDS:         "LONG_TERM_DEBT",
  SL_WAGES_PAYABLE:                 "ACCRUED_LIABILITIES",

  // ── Fixed assets (SPEC-FINENGINE-COMPLETE-DERIVATION-1) — feed Net Fixed Assets ─
  SL_PPE_GROSS:                     "PPE_GROSS",
  SL_ACCUMULATED_DEPRECIATION:      "ACCUMULATED_DEPRECIATION",

  // ── Income Statement (source-line _IS suffix → INCOME_PRIORITY canonical) ─
  SALARIES_WAGES_IS:                "PAYROLL",
  RENT_EXPENSE_IS:                  "RENT_EXPENSE",
  REPAIRS_MAINTENANCE_IS:           "REPAIRS_MAINTENANCE",
  INSURANCE_EXPENSE_IS:             "INSURANCE_EXPENSE",
  ADVERTISING_IS:                   "ADVERTISING",
  UTILITIES_IS:                     "UTILITIES",
  PROFESSIONAL_FEES_IS:             "PROFESSIONAL_FEES",
  OFFICERS_COMPENSATION:            "OFFICER_COMPENSATION",
};

/**
 * Normalize a fact key from extraction vocabulary to canonical model vocabulary.
 * Returns the canonical key when a mapping exists, else the original key unchanged.
 * PURE, no IO, never throws.
 */
export function normalizeFactKey(factKey: string): string {
  return EXTRACTION_TO_CANONICAL[factKey] ?? factKey;
}

/** PURE, NON-THROWING. Classify a fact key for report-only validation. */
export function classifyFactKey(factKey: string): FactKeyClass {
  if (CANONICAL_METRIC_KEYS.has(factKey)) return "canonical_metric";
  if (KNOWN_EXTRACTION_KEYS.has(factKey)) return "extraction";
  if (EXTRACTION_KEY_PREFIXES.some((p) => factKey.startsWith(p))) return "extraction";
  return "unknown";
}

/** Is this one of the canonical metric keys the engine owns? */
export function isCanonicalMetricKey(factKey: string): boolean {
  return CANONICAL_METRIC_KEYS.has(factKey);
}

/**
 * Validate a fact key. Report-only: returns `{ ok, class }`. `ok` is false only
 * for genuinely unknown keys; callers decide whether to warn (Phase 1) or reject
 * (later phase). Never throws.
 */
export function validateFactKey(factKey: string): { ok: boolean; class: FactKeyClass } {
  const cls = classifyFactKey(factKey);
  return { ok: cls !== "unknown", class: cls };
}
