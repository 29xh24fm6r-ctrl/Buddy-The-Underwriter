/**
 * Legal-review gate for Buddy-generated closing documents (SBA Note, Loan
 * Authorization & Agreement). Unlike the 11 SBA disclosure/application
 * forms — fixed federal fields, no legal judgment involved in filling them
 * — the Note and Authorization are drafted legal instruments. This gate
 * mirrors src/lib/identity/kyc/service.ts's hasValidIal2: fail-closed, no
 * exceptions, checked at request-signature time before any e-sign call.
 *
 * Kept free of "server-only" so it stays testable, same discipline as
 * kyc/service.ts and esign/signwell/service.ts.
 */

export type LegalReviewSupabaseClient = { from: (table: string) => any };

/** Document types that require an explicit human review before they may be sent for signature. */
export const FORMS_REQUIRING_LEGAL_REVIEW = new Set(["FORM_SBA_NOTE", "FORM_SBA_AUTHORIZATION"]);

export async function hasCompletedLegalReview(
  dealId: string,
  formCode: string,
  sb: LegalReviewSupabaseClient,
): Promise<boolean> {
  if (!FORMS_REQUIRING_LEGAL_REVIEW.has(formCode)) {
    return true;
  }

  const { data } = await sb
    .from("sba_legal_document_reviews")
    .select("id")
    .eq("deal_id", dealId)
    .eq("form_code", formCode)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();

  return Boolean(data);
}

export type MarkLegalReviewArgs = {
  dealId: string;
  bankId: string;
  formCode: string;
  reviewedBy: string;
  notes?: string | null;
};

export type MarkLegalReviewResult =
  | { ok: true }
  | { ok: false; reason: "UNSUPPORTED_FORM_CODE" | "UPSERT_FAILED"; detail?: string };

export async function markLegalReviewApproved(
  args: MarkLegalReviewArgs,
  sb: LegalReviewSupabaseClient,
): Promise<MarkLegalReviewResult> {
  if (!FORMS_REQUIRING_LEGAL_REVIEW.has(args.formCode)) {
    return { ok: false, reason: "UNSUPPORTED_FORM_CODE" };
  }

  const now = new Date().toISOString();
  const { error } = await sb.from("sba_legal_document_reviews").upsert(
    {
      deal_id: args.dealId,
      bank_id: args.bankId,
      form_code: args.formCode,
      status: "approved",
      reviewed_by: args.reviewedBy,
      reviewed_at: now,
      notes: args.notes ?? null,
      updated_at: now,
    },
    { onConflict: "deal_id,form_code" },
  );

  if (error) {
    return { ok: false, reason: "UPSERT_FAILED", detail: error.message };
  }
  return { ok: true };
}
