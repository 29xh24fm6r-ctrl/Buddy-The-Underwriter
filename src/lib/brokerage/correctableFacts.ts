// src/lib/brokerage/correctableFacts.ts
//
// The marketplace chat/voice concierge extracts structured facts from the
// conversation but never showed them back to the borrower — if Gemini
// mis-heard "$250,000" as "$25,000," the borrower had no way to see or fix
// it short of retyping and hoping the merge overwrote it. This is the
// client-safe (no "server-only") curated list of correctable fields, shared
// by the CapturedFactsPanel (renders/edits) and the correct-fact API route
// (persists). Deliberately a SUBSET of BORROWER_FIELD_REGISTRY's business
// scope, not the whole registry:
//
//  - business.* fields all map 1:1 to a single borrowers column, so a
//    correction has one unambiguous place to force-write.
//  - loan.amount_requested is hand-mapped to deals.loan_amount — the
//    registry says deal_loan_requests.requested_amount, but
//    propagateBorrowerFacts.ts deliberately EXCLUDES amount_requested/
//    use_of_proceeds from that table's write (they're set on deals/
//    borrower_applications instead in earlier steps of that function) —
//    deal_loan_requests.requested_amount is never actually populated via
//    the concierge pathway.
//  - owner/entity/pfs fields are out of scope for v1: they're array-indexed
//    (which owner?) and have no client UI yet to disambiguate.

import { BORROWER_FIELD_REGISTRY } from "@/lib/sba/forms/borrowerFieldRegistry";

export type CorrectableField = {
  factPath: string; // e.g. "business.legal_name"
  label: string;
  type: "string" | "number" | "boolean";
};

const BUSINESS_FIELDS: CorrectableField[] = BORROWER_FIELD_REGISTRY
  .filter((f) => f.entityScope === "business")
  .map((f) => ({ factPath: f.factPath, label: f.label, type: f.type === "date" ? "string" : f.type }));

export const CORRECTABLE_FACT_FIELDS: CorrectableField[] = [
  { factPath: "loan.amount_requested", label: "Loan amount requested", type: "number" },
  ...BUSINESS_FIELDS,
];

export function correctableFieldFor(factPath: string): CorrectableField | undefined {
  return CORRECTABLE_FACT_FIELDS.find((f) => f.factPath === factPath);
}

/** Reads a dotted factPath (e.g. "business.legal_name") out of the merged facts bag. */
export function readFactValue(facts: Record<string, unknown> | null | undefined, factPath: string): unknown {
  const [scope, field] = factPath.split(".");
  if (!scope || !field || !facts) return null;
  const scopeObj = facts[scope];
  if (!scopeObj || typeof scopeObj !== "object") return null;
  return (scopeObj as Record<string, unknown>)[field] ?? null;
}
