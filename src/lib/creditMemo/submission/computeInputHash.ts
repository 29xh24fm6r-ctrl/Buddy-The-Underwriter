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
