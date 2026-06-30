/**
 * SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 1 — canonical fact-key normalization.
 *
 * The IRS identity validator (`validateDocumentFacts`) binds FormSpec check
 * operands by EXACT canonical key. The extractor, however, emits its own
 * vocabulary (`M1_TAXABLE_INCOME`, `SL_TOTAL_*`, `WAGES_W2`, `SCHED_E_NET`,
 * `SCHEDULE_C_*`, …). Without normalization the operands never bind and every
 * check is `skipped` — the arithmetic-integrity gate is inert.
 *
 * Canonical-vocabulary rule (foundational): the FormSpec / IRS-line vocabulary is
 * canonical. Each alias binds to the IRS line that makes the check's arithmetic
 * IDENTITY hold — NOT a name match. The headline example: `1120_TAXABLE_INCOME`
 * verifies `TOTAL_INCOME − TOTAL_DEDUCTIONS = TAXABLE_INCOME` (line 11 − line 27 =
 * line 28). Line 28 is taxable income BEFORE NOL/special deductions = Schedule M-1
 * line 10 = `M1_TAXABLE_INCOME` — NOT `NET_INCOME` (line 30, after NOL). So the
 * canonical `TAXABLE_INCOME` operand binds to `M1_TAXABLE_INCOME`.
 *
 * HARD non-goal: never alias to a DERIVED fact (e.g. the spread's computed
 * GROSS_PROFIT). Aliases bind raw extracted facts only, or the identity becomes
 * tautological (false-green).
 *
 * Pure module — no DB, no server-only.
 */

/**
 * Extractor fact_key → canonical FormSpec key(s) the value satisfies.
 *
 * Values are usually 1:1. A few extractor keys legitimately satisfy TWO distinct
 * canonical operands across different FormSpecs (one extractor key, one IRS line,
 * referenced under two canonical names) — e.g. `SCHEDULE_C_NET_PROFIT` feeds both
 * the Schedule-C `NET_PROFIT` identity and the 1040 `SCH_C_NET_PROFIT` income
 * component. A flat `Record<string,string>` cannot express that, so values may be
 * a string array. (This is the only structural deviation from the spec's sketch
 * signature; it is required to reach the completeness the spec mandates — T5.)
 *
 * Each entry carries its IRS-line rationale.
 */
export const EXTRACTOR_TO_CANONICAL: Record<string, string | string[]> = {
  // ── Income / P&L ────────────────────────────────────────────────────────
  // 1120 line 28 = line 11 − line 27 = taxable income BEFORE NOL/special
  // deductions = Schedule M-1 line 10. This is the operand the 1120_TAXABLE_INCOME
  // identity needs — NOT NET_INCOME (line 30, after NOL). Direct TAXABLE_INCOME,
  // when emitted, wins via canonicalizeFactMap's direct-wins rule.
  M1_TAXABLE_INCOME: "TAXABLE_INCOME",

  // ── Schedule L balance sheet (per the tax return) ───────────────────────
  SL_TOTAL_ASSETS: "TOTAL_ASSETS",            // Sch L total assets
  SL_TOTAL_LIABILITIES: "TOTAL_LIABILITIES",  // Sch L total liabilities
  SL_TOTAL_EQUITY: "TOTAL_EQUITY",            // Sch L total equity / capital

  // ── Form 1040 income components ─────────────────────────────────────────
  WAGES_W2: "W2_WAGES",                        // 1040 line 1a wages (W-2 box 1)
  // Schedule E NET rental income (the amount that flows to the 1040). The
  // 1040_INCOME_COMPONENTS identity sums W2 + SchE + K1 + SchC ≈ TOTAL_INCOME, so
  // Sch E contributes its NET (post-expense) figure, not gross rents. The
  // scheduleE SCH_E_RENTAL_NET identity also treats SCH_E_RENTAL_TOTAL as the net
  // residual (rents − expenses). Both want net → SCHED_E_NET.
  SCHED_E_NET: "SCH_E_RENTAL_TOTAL",
  // Schedule E gross rents received (Sch E Part I line 3) — lhs of SCH_E_RENTAL_NET.
  SCH_E_GROSS_RENTS_RECEIVED: "SCH_E_RENTS_RECEIVED",

  // ── Schedule C (sole proprietor) ────────────────────────────────────────
  // SCHEDULE_C_NET_PROFIT (Sch C line 31) satisfies BOTH the 1040 SCH_C_NET_PROFIT
  // income component AND the scheduleC NET_PROFIT identity (line 31).
  SCHEDULE_C_NET_PROFIT: ["SCH_C_NET_PROFIT", "NET_PROFIT"],
  SCHEDULE_C_GROSS_RECEIPTS: "GROSS_RECEIPTS", // Sch C line 1
  SCHEDULE_C_COGS: "COST_OF_GOODS_SOLD",       // Sch C line 4
  SCHEDULE_C_GROSS_PROFIT: "GROSS_PROFIT",     // Sch C line 5
  // Sch C line 28 total expenses = the TOTAL_DEDUCTIONS operand of the scheduleC
  // SCHC_NET_PROFIT identity (GROSS_PROFIT − TOTAL_DEDUCTIONS = NET_PROFIT;
  // sourceDescription "Schedule C Lines 5, 28, 31"). NOTE: this sources
  // TOTAL_DEDUCTIONS for the Schedule-C context only; the corporate-return
  // TOTAL_DEDUCTIONS (1120 line 27 / 1065 line 21 / 1120S line 20) is now
  // extracted directly by the BTR prompt (v4) under the canonical key
  // TOTAL_DEDUCTIONS — SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 3 (revised) —
  // so it binds the 1120_TAXABLE_INCOME identity without an alias.
  SCHEDULE_C_TOTAL_EXPENSES: "TOTAL_DEDUCTIONS",
};

/**
 * Canonical operands the extractor already emits under the SAME name (no alias
 * needed). Grounded in the live extractor vocabulary. ORDINARY_BUSINESS_INCOME is
 * emitted directly by the BTR extractor for pass-throughs (1065 line 22 / 1120S
 * line 21); it is absent only on C-corp returns, which have no OBI line.
 */
export const CANONICAL_KEYS_EMITTED_VERBATIM: ReadonlySet<string> = new Set([
  "GROSS_RECEIPTS",
  "COST_OF_GOODS_SOLD",
  "GROSS_PROFIT",
  "TOTAL_INCOME",
  "TAXABLE_INCOME",
  "ORDINARY_BUSINESS_INCOME",
  "K1_ORDINARY_INCOME",
  "SCH_E_DEPRECIATION",
]);

/**
 * FormSpec operands with NO current extractor source — genuinely unextracted,
 * restored in later phases. Kept explicit so the completeness guard (T5) stays
 * honest about what Phase 1 does NOT yet cover.
 *
 * - SCH_E_MORTGAGE_INTEREST: Schedule E line 12; only used by the approximate,
 *   non-required SCH_E_RENTAL_NET check. No extractor key emits it today.
 *   (Corporate-return TOTAL_DEDUCTIONS line 27 is now extracted directly by the
 *   BTR prompt v4 — Phase 3 revised — so it is not pending.)
 */
export const OPERANDS_PENDING_EXTRACTION: ReadonlySet<string> = new Set([
  "SCH_E_MORTGAGE_INTEREST",
]);

/**
 * Augment a raw extracted fact map with canonical-keyed aliases.
 *
 * Rules:
 *  - The raw map is preserved; canonical aliases are added on top.
 *  - Direct (canonical) values WIN: an alias never overwrites an existing,
 *    non-null canonical value.
 *  - Null/undefined raw values are treated as absent (no alias written).
 */
export function canonicalizeFactMap(
  raw: Record<string, number | null>,
): Record<string, number | null> {
  const out: Record<string, number | null> = { ...raw };

  for (const [extractorKey, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    const targets = EXTRACTOR_TO_CANONICAL[extractorKey];
    if (!targets) continue;
    const canonicalKeys = Array.isArray(targets) ? targets : [targets];
    for (const canonical of canonicalKeys) {
      // Direct-wins: never overwrite an existing canonical value with an alias.
      if (out[canonical] === null || out[canonical] === undefined) {
        out[canonical] = value;
      }
    }
  }

  return out;
}
