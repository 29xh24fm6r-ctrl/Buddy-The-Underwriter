// src/lib/fixTargets.ts

export type FixTargetKind =
  | "banker_loan_products"
  | "documents_upload"
  | "borrower_portal_request"
  | "deal_chat"
  | "deal_cockpit_top";

export type FixTarget = {
  kind: FixTargetKind;
  dealId: string;
  // Optional: focus a specific field inside the card
  focus?: string; // e.g. "amount", "termMonths"
};

export function fixTargetKey(t: FixTarget) {
  return `${t.kind}:${t.dealId}`;
}
