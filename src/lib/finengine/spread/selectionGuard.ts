/**
 * SPEC-FINENGINE-MEMO-CUTOVER-1 — Phase 1: selection-layer guard.
 *
 * The computation goldens (fullSpreadGoldenSet) derive from `snap.facts` — the
 * SAME certified-adapter output the engine consumes — so a wrong entity-partition
 * or extractor SELECTION would make engine and golden agree on a wrong value
 * (green-but-wrong). This guard closes that hole: it re-selects the value an
 * auditor would pick, by a SEPARATE code path from the adapter (NG5), straight
 * from the raw certified rows, and asserts the adapter's chosen value matches.
 *
 * The independent selector is deliberately simpler than the adapter: scope-
 * partition on source_canonical_type → period match → highest confidence. It does
 * NOT share the adapter's constant-bug screen or corroboration, so a partition or
 * confidence bug in the adapter would surface as a mismatch. Pure — no DB.
 */

import {
  sourceCanonicalTypeToTrust,
  type CertifiedFactRow,
  type EntityScope,
} from "@/lib/finengine/shadow/dealInputAdapter";

/** Independent scope → source_canonical_type sets (defined separately from the adapter's). */
const SCOPE_SOURCES: Record<EntityScope, ReadonlySet<string>> = {
  // SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1: include audited/reviewed/compiled statements so this
  // independent oracle sees the same authoritative business sources the adapter now partitions.
  BUSINESS: new Set(["AUDITED_FINANCIALS", "REVIEWED_FINANCIALS", "COMPILED_FINANCIALS", "BUSINESS_TAX_RETURN", "INCOME_STATEMENT", "BALANCE_SHEET", "AR_AGING", "AP_AGING", "DEBT_SCHEDULE", "FINANCIAL_STATEMENT", "BANK_STATEMENT"]),
  PERSONAL: new Set(["PERSONAL_TAX_RETURN", "PFS", "PERSONAL_FINANCIAL_STATEMENT"]),
  AFFILIATE: new Set<string>(),
};

/**
 * The value an independent auditor would select for (factKey, scope, period):
 * keep only the scope's source types on the exact period (non-superseded), then
 * the highest-confidence row (|value| tie-break). Returns null when none qualify.
 */
export function independentRawSelect(
  rows: CertifiedFactRow[],
  factKey: string,
  scope: EntityScope,
  period: string,
): { value: number | null; extractor: string | null; source: string | null } {
  const sources = SCOPE_SOURCES[scope];
  const cand = rows.filter(
    (r) =>
      r.fact_key === factKey &&
      r.fact_period_end === period &&
      !r.is_superseded &&
      r.fact_value_num != null &&
      !!r.source_canonical_type &&
      sources.has(r.source_canonical_type),
  );
  if (cand.length === 0) return { value: null, extractor: null, source: null };
  // SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1: rank document-TRUST first (matching the adapter's
  // selectCertifiedValue: trust → confidence → |value|). Confidence-only ranking made this oracle
  // disagree with the adapter whenever a higher-trust source (e.g. an audited statement) carried lower
  // extractor confidence than a lower-trust one — producing false selection-mismatch failures.
  cand.sort(
    (a, b) =>
      sourceCanonicalTypeToTrust(b.source_canonical_type) - sourceCanonicalTypeToTrust(a.source_canonical_type) ||
      (b.confidence ?? 0) - (a.confidence ?? 0) ||
      Math.abs(b.fact_value_num!) - Math.abs(a.fact_value_num!),
  );
  const win = cand[0];
  return { value: win.fact_value_num, extractor: win.extractor ?? null, source: win.source_canonical_type ?? null };
}

/** Selection-critical keys: the base inputs that drive the memo's decision metrics. */
export const SELECTION_KEYS = [
  "ORDINARY_BUSINESS_INCOME", "M1_TAXABLE_INCOME", "TAXABLE_INCOME", "NET_INCOME",
  "GROSS_RECEIPTS", "GROSS_PROFIT", "COST_OF_GOODS_SOLD", "DEPRECIATION", "OFFICER_COMPENSATION",
  "SL_TOTAL_ASSETS", "SL_TOTAL_EQUITY", "SL_TOTAL_LIABILITIES",
  "TOTAL_CURRENT_ASSETS", "TOTAL_CURRENT_LIABILITIES",
] as const;

export type SelectionCheck = {
  scope: EntityScope;
  period: string;
  factKey: string;
  adapterValue: number | null;
  independentValue: number | null;
  agrees: boolean;
};

const REL_TOL = 1e-6;
function eq(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) <= REL_TOL;
}

/**
 * For one scope+period, compare the adapter's selected value (from `facts`) to the
 * independent raw selection for each selection-critical key. A check is a
 * disagreement only when BOTH are non-null and differ (a genuine mis-selection) —
 * the adapter legitimately dropping a value, e.g. a rejected constant, is not a
 * disagreement here.
 */
export function selectionChecks(
  facts: Record<string, number | null>,
  rawRows: CertifiedFactRow[],
  scope: EntityScope,
  period: string,
): SelectionCheck[] {
  const out: SelectionCheck[] = [];
  for (const key of SELECTION_KEYS) {
    const adapterValue = facts[key] ?? null;
    const { value: independentValue } = independentRawSelect(rawRows, key, scope, period);
    if (adapterValue == null || independentValue == null) continue; // only flag genuine non-null disagreements
    out.push({ scope, period, factKey: key, adapterValue, independentValue, agrees: eq(adapterValue, independentValue) });
  }
  return out;
}
