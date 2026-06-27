/**
 * SPEC-FINENGINE-SHADOW-EBITDA-1 — EBITDA golden-set (independent derivation).
 *
 * The golden value is computed from the tax facts by a SEPARATE code path from
 * the engine method (NG2 — never reverse-engineered from the method output).
 * The runner sets each `GoldenSetEntry.expectedNewValue` to this independent
 * value; `compareProducers` then classifies the engine's output as INTENDED
 * when it matches (proving the C-corp fix), and UNEXPECTED otherwise.
 *
 * `EBITDA(Y)` (conservative, base metric):
 *     base(Y) + INTEREST_EXPENSE + DEPRECIATION + AMORTIZATION
 *   where base(Y) is the C-corp pre-tax income (M1_TAXABLE_INCOME ?? TAXABLE_INCOME;
 *   pre-tax, so taxes are NOT added back), or the pass-through ordinary business
 *   income. Owner-comp / §179 are layered only into ADJUSTED_EBITDA.
 *
 * Pure — no DB, no dependency on foundation.ts (independence is the point).
 */

const num = (v: number | null | undefined): number | null => (v == null ? null : v);

/** The legacy EBITDA bug, pre-registered as the value we EXPECT to diverge from. */
export const LEGACY_OMNICARE_EBITDA_BUG = -457567;

/** Independent C-corp / pass-through base income selection (NOT foundation's). */
export function goldenBaseIncome(facts: Record<string, number | null>): { value: number | null; key: string } {
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

export type GoldenEbitda = {
  base: number | null;
  baseKey: string;
  interest: number;
  depreciation: number;
  amortization: number;
  conservativeEbitda: number | null; // base + interest + D&A (the EBITDA metric)
  warnings: string[];
};

/** Independent conservative EBITDA from the facts (the §3 EBITDA(Y) formula). */
export function goldenConservativeEbitda(facts: Record<string, number | null>): GoldenEbitda {
  const { value: base, key: baseKey } = goldenBaseIncome(facts);
  const interest = num(facts["INTEREST_EXPENSE"]) ?? 0;
  const depreciation = num(facts["DEPRECIATION"]) ?? 0;
  const amortization = num(facts["AMORTIZATION"]) ?? 0;
  const warnings: string[] = [];
  if (base == null) warnings.push("no base income (OBI / M1_TAXABLE_INCOME / TAXABLE_INCOME / NET_INCOME) — EBITDA unresolved");
  if (facts["INTEREST_EXPENSE"] == null) warnings.push("no INTEREST_EXPENSE (treated as 0)");
  if (facts["AMORTIZATION"] == null) warnings.push("no AMORTIZATION (treated as 0)");
  const conservativeEbitda = base == null ? null : base + interest + depreciation + amortization;
  return { base, baseKey, interest, depreciation, amortization, conservativeEbitda, warnings };
}

/**
 * Independent owner-comp normalization (signed): excess over a market replacement
 * manager when over-paid; a market-salary deduction when under-paid. Market rate
 * is the documented 10%-of-revenue BLS-proxy benchmark. Independent of foundation.
 */
export function goldenOwnerCompExcess(facts: Record<string, number | null>): { amount: number; note: string } {
  const officer = num(facts["OFFICER_COMPENSATION"]);
  const revenue = num(facts["GROSS_RECEIPTS"]);
  if (officer == null || revenue == null || revenue === 0) {
    return { amount: 0, note: "owner comp or revenue unavailable — no normalization" };
  }
  const market = 0.1 * revenue;
  const pct = officer / revenue;
  if (pct > 0.4) return { amount: officer - market, note: "over-paid: excess over 10% market added back" };
  if (pct < 0.02) return { amount: -(market - officer), note: "under-paid: market replacement salary deducted" };
  return { amount: 0, note: "owner comp within market range" };
}

/** Independent §179 acceleration-only (NOT a full add-back). */
export function goldenS179Acceleration(facts: Record<string, number | null>): number {
  const explicit = num(facts["SECTION_179_ACCELERATION"]);
  if (explicit != null) return Math.max(0, explicit);
  const s179 = num(facts["SECTION_179_EXPENSE"]);
  const sl = num(facts["STRAIGHT_LINE_DEPRECIATION"]);
  if (s179 != null && sl != null) return Math.max(0, s179 - sl);
  return 0; // §179 is not a full add-back; absent a straight-line baseline, add nothing
}

/** Independent ADJUSTED EBITDA = conservative EBITDA + owner-comp excess + §179 acceleration. */
export function goldenAdjustedEbitda(facts: Record<string, number | null>): number | null {
  const cons = goldenConservativeEbitda(facts).conservativeEbitda;
  if (cons == null) return null;
  return cons + goldenOwnerCompExcess(facts).amount + goldenS179Acceleration(facts);
}

/** A rounding tolerance helper — golden vs engine agree within $1. */
export function withinTolerance(a: number | null, b: number | null, abs = 1): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= abs;
}
