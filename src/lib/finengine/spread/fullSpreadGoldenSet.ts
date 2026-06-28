/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 — Phase 3: independent golden-set.
 *
 * The golden values are derived from the FILED 1120 line items by a SEPARATE
 * code path from computeDealSpread (NG4 — never reverse-engineered from the
 * engine's own selection). Each value documents the line it comes from. The
 * validator compares the engine's live output to these and classifies every
 * divergence ZERO / INTENDED / UNEXPECTED.
 *
 * Conservative business EBITDA per year, from the business return only:
 *     EBITDA(Y) = base(Y) + INTEREST_EXPENSE(Y) + DEPRECIATION(Y) + AMORTIZATION(Y)
 *   base(Y) = C-corp pre-tax income (M1_TAXABLE_INCOME ?? TAXABLE_INCOME, pre-tax
 *   so NO taxes added back) or pass-through ordinary business income. Interest is
 *   the business return's per-year interest line — NEVER the stranded 2025/2026
 *   INTEREST_EXPENSE (those are not tax-year facts; NG3).
 *
 * Pure — no DB, no dependency on dealSpread.ts (independence is the point).
 */

const num = (v: number | null | undefined): number | null => (v == null ? null : v);

export type GoldenMetric = {
  metric: string;
  period: string;
  expected: number | null;
  source: string; // the filed line(s) this was derived from
};

/** Independent base income (business): OBI → M1 taxable → taxable → net income. */
export function goldenBase(facts: Record<string, number | null>): { value: number | null; key: string } {
  const obi = num(facts["ORDINARY_BUSINESS_INCOME"]);
  if (obi != null) return { value: obi, key: "ORDINARY_BUSINESS_INCOME" };
  const m1 = num(facts["M1_TAXABLE_INCOME"]);
  if (m1 != null) return { value: m1, key: "M1_TAXABLE_INCOME" };
  const taxable = num(facts["TAXABLE_INCOME"]);
  if (taxable != null) return { value: taxable, key: "TAXABLE_INCOME" };
  const ni = num(facts["NET_INCOME"]);
  if (ni != null) return { value: ni, key: "NET_INCOME" };
  return { value: null, key: "NONE" };
}

/** Independent conservative EBITDA for one period's business facts. */
export function goldenEbitda(facts: Record<string, number | null>): { value: number | null; source: string } {
  const { value: base, key } = goldenBase(facts);
  if (base == null) return { value: null, source: "no base income line on the return" };
  const interest = num(facts["INTEREST_EXPENSE"]) ?? 0;
  const dep = num(facts["DEPRECIATION"]) ?? 0;
  const amort = num(facts["AMORTIZATION"]) ?? 0;
  return {
    value: base + interest + dep + amort,
    source: `${key}(${base}) + interest(${interest}) + dep(${dep}) + amort(${amort})`,
  };
}

/** Independent current ratio from the filed Schedule-L current lines. */
export function goldenCurrentRatio(facts: Record<string, number | null>): { value: number | null; source: string } {
  const ca = num(facts["TOTAL_CURRENT_ASSETS"]);
  const cl = num(facts["TOTAL_CURRENT_LIABILITIES"]);
  if (ca == null || cl == null || cl === 0) return { value: null, source: "TOTAL_CURRENT_ASSETS / TOTAL_CURRENT_LIABILITIES (missing)" };
  return { value: ca / cl, source: `TOTAL_CURRENT_ASSETS(${ca}) ÷ TOTAL_CURRENT_LIABILITIES(${cl})` };
}

/** Independent debt-to-equity from Schedule-L total liabilities ÷ total equity. */
export function goldenDebtToEquity(facts: Record<string, number | null>): { value: number | null; source: string } {
  const tl = num(facts["SL_TOTAL_LIABILITIES"]) ?? num(facts["TOTAL_LIABILITIES"]);
  const eq = num(facts["SL_TOTAL_EQUITY"]) ?? num(facts["TOTAL_EQUITY"]);
  if (tl == null || eq == null || eq === 0) return { value: null, source: "SL_TOTAL_LIABILITIES / SL_TOTAL_EQUITY (missing)" };
  return { value: tl / eq, source: `SL_TOTAL_LIABILITIES(${tl}) ÷ SL_TOTAL_EQUITY(${eq})` };
}

/** Independent gross margin from gross profit ÷ gross receipts. */
export function goldenGrossMargin(facts: Record<string, number | null>): { value: number | null; source: string } {
  const gp = num(facts["GROSS_PROFIT"]);
  const rev = num(facts["GROSS_RECEIPTS"]) ?? num(facts["TOTAL_REVENUE"]);
  if (gp == null || rev == null || rev === 0) return { value: null, source: "GROSS_PROFIT / GROSS_RECEIPTS (missing)" };
  return { value: gp / rev, source: `GROSS_PROFIT(${gp}) ÷ GROSS_RECEIPTS(${rev})` };
}

/** Independent effective tangible net worth = book equity − intangibles (filed Schedule-L). */
export function goldenEffectiveTNW(facts: Record<string, number | null>): { value: number | null; source: string } {
  const eq = num(facts["SL_TOTAL_EQUITY"]) ?? num(facts["TOTAL_EQUITY"]);
  if (eq == null) return { value: null, source: "SL_TOTAL_EQUITY (missing)" };
  const intangibles = num(facts["SL_INTANGIBLES_GROSS"]) ?? 0;
  return { value: eq - intangibles, source: `SL_TOTAL_EQUITY(${eq}) − intangibles(${intangibles})` };
}

/** Independent debt-to-ETNW = total liabilities ÷ effective tangible net worth. */
export function goldenDebtToEtnw(facts: Record<string, number | null>): { value: number | null; source: string } {
  const tl = num(facts["SL_TOTAL_LIABILITIES"]) ?? num(facts["TOTAL_LIABILITIES"]);
  const etnw = goldenEffectiveTNW(facts).value;
  if (tl == null || etnw == null || etnw === 0) return { value: null, source: "SL_TOTAL_LIABILITIES / ETNW (missing)" };
  return { value: tl / etnw, source: `SL_TOTAL_LIABILITIES(${tl}) ÷ ETNW(${etnw})` };
}

/** Independent total leverage = funded debt ÷ conservative EBITDA (skips when debt absent). */
export function goldenLeverageTotal(facts: Record<string, number | null>): { value: number | null; source: string } {
  const debt = num(facts["SL_MORTGAGES_NOTES_BONDS"]);
  const ebitda = goldenEbitda(facts).value;
  if (debt == null || ebitda == null || ebitda === 0) return { value: null, source: "SL_MORTGAGES_NOTES_BONDS / EBITDA (missing)" };
  return { value: debt / ebitda, source: `SL_MORTGAGES_NOTES_BONDS(${debt}) ÷ EBITDA(${ebitda})` };
}

/**
 * Independent DSCR / FCCR derivations require a debt-service input that the
 * business tax snapshot does not carry; they resolve to null until the spread
 * surfaces those metrics (Phase 2 wires global cash flow / debt service). Defined
 * here so the gate's coverage list is complete and validates them the moment they
 * are emitted.
 */
export function goldenDscr(facts: Record<string, number | null>): { value: number | null; source: string } {
  const cash = num(facts["CASH_FLOW_AVAILABLE"]);
  const ds = num(facts["ANNUAL_DEBT_SERVICE"]);
  if (cash == null || ds == null || ds === 0) return { value: null, source: "CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE (not in tax snapshot — pending Phase 2)" };
  return { value: cash / ds, source: `CASH_FLOW_AVAILABLE(${cash}) ÷ ANNUAL_DEBT_SERVICE(${ds})` };
}

/**
 * Pre-registered OmniCare expected business EBITDA per tax year, derived by hand
 * from the filed 1120 line items (the audited golden numbers). Used as a hard
 * anchor in tests and the report independent of any fact-map plumbing.
 *   2022: base 0 + dep 151,225                       = 151,225
 *   2023: base −457,567 + dep 61,656                 = −395,911
 *   2024: base 200,925 + dep 210,207                 = 411,132
 * Interest is 0 on every tax year — the only INTEREST_EXPENSE facts are stranded
 * on 2025/2026 (NG3: never borrowed back into a tax year).
 */
export const OMNICARE_GOLDEN_EBITDA: Record<string, { expected: number; source: string }> = {
  "2022-12-31": { expected: 151225, source: "M1_TAXABLE_INCOME(0) + DEPRECIATION(151,225); no tax-year interest" },
  "2023-12-31": { expected: -395911, source: "M1_TAXABLE_INCOME(−457,567 business loss) + DEPRECIATION(61,656); no tax-year interest" },
  "2024-12-31": { expected: 411132, source: "M1_TAXABLE_INCOME(200,925) + DEPRECIATION(210,207); no tax-year interest" },
};
