// Pure conflict detector for the Memo Input Completeness Layer.
//
// Compares like-for-like fact values across sources (tax returns, P&L,
// balance sheet, bank statements, borrower-entered values, banker
// overrides, financial snapshot) and flags value mismatches above a
// tolerance threshold.

import type { DealFactConflict } from "./types";

export type FactCandidate = {
  fact_key: string;
  source_label: string; // human-readable: "tax_return_2024", "p&l_t12", etc.
  source_role:
    | "tax_return"
    | "income_statement"
    | "balance_sheet"
    | "bank_statement"
    | "borrower_entered"
    | "banker_override"
    | "financial_snapshot"
    | "personal_income"
    | "rent_roll"
    | "pricing_decision";
  value: number | null;
  period_end?: string | null;
  source_document_id?: string | null;
  recorded_at?: string | null;
};

// Detected conflict — input shape for persisting to deal_fact_conflicts.
export type DetectedConflict = Pick<
  DealFactConflict,
  "fact_key" | "conflict_type" | "source_a" | "source_b" | "status"
>;

// Default tolerance: 1% of the larger absolute value, with a $1 floor.
// Two values that round to within tolerance are considered the same.
function isMaterialDifference(a: number, b: number): boolean {
  const larger = Math.max(Math.abs(a), Math.abs(b));
  if (larger === 0) return false;
  const tol = Math.max(larger * 0.01, 1);
  return Math.abs(a - b) > tol;
}

// Group candidates by fact_key. For each group, pick the two most divergent
// values (largest spread) and emit ONE conflict row. We don't fan out N×N
// pairs — bankers can resolve N sources by picking one canonical value, so
// representing the conflict as a single row keeps the UI tractable.
export function detectFactConflicts(
  candidates: FactCandidate[],
): DetectedConflict[] {
  const grouped = new Map<string, FactCandidate[]>();
  for (const c of candidates) {
    if (typeof c.value !== "number" || !Number.isFinite(c.value)) continue;
    const list = grouped.get(c.fact_key) ?? [];
    list.push(c);
    grouped.set(c.fact_key, list);
  }

  const conflicts: DetectedConflict[] = [];

  for (const [factKey, list] of grouped) {
    if (list.length < 2) continue;

    // Filter to one representative per (source_role, period_end) pair so
    // multiple snapshots of the same source don't pollute the spread.
    const representatives = new Map<string, FactCandidate>();
    for (const c of list) {
      const key = `${c.source_role}|${c.period_end ?? ""}`;
      const existing = representatives.get(key);
      if (
        !existing ||
        // Prefer more recently recorded over older when same role/period.
        (c.recorded_at ?? "") > (existing.recorded_at ?? "")
      ) {
        representatives.set(key, c);
      }
    }
    const reps = [...representatives.values()];
    if (reps.length < 2) continue;

    // Find the most-divergent pair.
    let best: { a: FactCandidate; b: FactCandidate; spread: number } | null = null;
    for (let i = 0; i < reps.length; i++) {
      for (let j = i + 1; j < reps.length; j++) {
        const a = reps[i].value as number;
        const b = reps[j].value as number;
        const spread = Math.abs(a - b);
        if (!best || spread > best.spread) {
          best = { a: reps[i], b: reps[j], spread };
        }
      }
    }
    if (!best) continue;

    const aVal = best.a.value as number;
    const bVal = best.b.value as number;
    if (!isMaterialDifference(aVal, bVal)) continue;

    conflicts.push({
      fact_key: factKey,
      conflict_type: "value_mismatch",
      source_a: candidateToJson(best.a),
      source_b: candidateToJson(best.b),
      status: "open",
    });
  }

  return conflicts;
}

function candidateToJson(c: FactCandidate): Record<string, unknown> {
  return {
    label: c.source_label,
    role: c.source_role,
    value: c.value,
    period_end: c.period_end ?? null,
    source_document_id: c.source_document_id ?? null,
    recorded_at: c.recorded_at ?? null,
  };
}

// Set of fact keys the layer cares about (revenue, EBITDA/SDE, net income,
// cash flow, ADS, DSCR, loan amount, collateral value, ownership, liquidity,
// net worth). Used by reconcileDealFacts to decide which keys to compare.
export const RECONCILED_FACT_KEYS: readonly string[] = [
  "revenue",
  "ebitda",
  "sde",
  "net_income",
  "cash_flow_available",
  "annual_debt_service",
  "dscr",
  "loan_amount",
  "collateral_value",
  "ownership_pct",
  "liquidity",
  "net_worth",
];
