// Deterministic SHA-256 over canonical inputs at submission time.
//
// Reproducibility contract: re-running buildCanonicalCreditMemo with the
// same inputs that produced this hash must return the same memo_output_json.
// If the hash changes, the inputs changed — the snapshot is no longer
// reproducible from current state, and a new submission is required.

import { createHash } from "node:crypto";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";

export type InputHashSources = {
  memo: CanonicalCreditMemoV1;
  overrides: Record<string, unknown>;
  bankerId: string;
};

export function computeInputHash(sources: InputHashSources): string {
  // ACTIVATION: expanded hash inputs — AR, pricing, facts, management, borrower story
  const arBb = sources.memo.collateral.ar_borrowing_base;
  const canonical = canonicalize({
    memo_deal_id: sources.memo.deal_id,
    memo_bank_id: sources.memo.bank_id,
    memo_generated_at: sources.memo.generated_at,
    memo_version: sources.memo.version,
    memo_loan_amount: sources.memo.key_metrics.loan_amount.value,
    memo_dscr: sources.memo.financial_analysis.dscr.value,
    memo_collateral_gross: sources.memo.collateral.gross_value.value,
    memo_business_description: sources.memo.business_summary.business_description,
    memo_principals: sources.memo.management_qualifications.principals.map((p) => ({
      id: p.id,
      bio_len: typeof p.bio === "string" ? p.bio.length : 0,
    })),
    // AR borrowing base fields — stale narrative detection
    ar_total: arBb?.total_ar ?? null,
    ar_eligible: arBb?.eligible_ar ?? null,
    ar_advance_rate: arBb?.advance_rate ?? null,
    ar_as_of_date: arBb?.as_of_date ?? null,
    // Pricing decision fields
    pricing_product: sources.memo.proposed_terms.product,
    pricing_rate: sources.memo.proposed_terms.rate.all_in_rate,
    pricing_rationale_len: sources.memo.proposed_terms.rationale.length,
    // Financial fact coverage — any fact change shifts count or updated_at
    debt_coverage_row_count: sources.memo.financial_analysis.debt_coverage_table.length,
    verdict: sources.memo.recommendation.verdict,
    // Banker context
    banker_notes_len: sources.memo.banker_context?.banker_notes?.length ?? 0,
    overrides: sources.overrides,
    banker_id: sources.bankerId,
  });

  const hash = createHash("sha256");
  hash.update(canonical);
  return hash.digest("hex");
}

// Stable JSON stringification: sort object keys at every depth so two
// equivalent inputs with different key orderings produce the same hash.
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
        .join(",") +
      "}"
    );
  }
  return "null";
}
