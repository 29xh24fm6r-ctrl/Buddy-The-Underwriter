import { buildLoanAuthorizationInput, type LoanAuthorizationInputBuilderClient } from "@/lib/sba/forms/loanAuthorization/inputBuilder";
import type { LoanAuthorizationBuildResult } from "@/lib/sba/forms/loanAuthorization/build";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export const LOAN_AUTHORIZATION_FORM_CODE = "FORM_SBA_AUTHORIZATION";

/** DB-aware wrapper — same pattern as sbaNote/buildWithSignature.ts. */
export async function buildLoanAuthorizationWithSignature(
  dealId: string,
  bankId: string,
  sb: LoanAuthorizationInputBuilderClient,
): Promise<LoanAuthorizationBuildResult> {
  const result = await buildLoanAuthorizationInput(dealId, bankId, sb);

  const [signedDocRes, reviewRes] = await Promise.all([
    result.borrower_ownership_entity_id
      ? sb
          .from("signed_documents")
          .select("signature_completed_at, expires_at")
          .eq("deal_id", dealId)
          .eq("form_code", LOAN_AUTHORIZATION_FORM_CODE)
          .eq("signer_ownership_entity_id", result.borrower_ownership_entity_id)
          .order("signature_completed_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sb
      .from("sba_legal_document_reviews")
      .select("status, reviewed_by, reviewed_at")
      .eq("deal_id", dealId)
      .eq("form_code", LOAN_AUTHORIZATION_FORM_CODE)
      .maybeSingle(),
  ]);

  let signature = result.signature;
  const signedDoc = signedDocRes.data as { signature_completed_at: string; expires_at: string } | null;
  if (signedDoc) {
    const expiresAt = new Date(signedDoc.expires_at);
    const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / MS_PER_DAY;
    signature = {
      has_valid_signature: expiresAt.getTime() > Date.now(),
      signed_at: signedDoc.signature_completed_at,
      expires_at: signedDoc.expires_at,
      needs_resignature: daysUntilExpiry <= RESIGN_WARNING_DAYS,
    };
  }

  const review = reviewRes.data as { status: string; reviewed_by: string | null; reviewed_at: string | null } | null;
  const legal_review = {
    approved: review?.status === "approved",
    reviewed_by: review?.reviewed_by ?? null,
    reviewed_at: review?.reviewed_at ?? null,
  };

  return { ...result, signature, legal_review };
}
