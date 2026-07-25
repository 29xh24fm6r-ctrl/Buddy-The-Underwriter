import { buildSbaNoteInput, type SbaNoteInputBuilderClient } from "@/lib/sba/forms/sbaNote/inputBuilder";
import type { SbaNoteBuildResult } from "@/lib/sba/forms/sbaNote/build";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export const SBA_NOTE_FORM_CODE = "FORM_SBA_NOTE";

/** DB-aware wrapper — same split as form601/form155's buildWithSignature. */
export async function buildSbaNoteWithSignature(
  dealId: string,
  bankId: string,
  sb: SbaNoteInputBuilderClient,
): Promise<SbaNoteBuildResult> {
  const result = await buildSbaNoteInput(dealId, bankId, sb);

  const [signedDocRes, reviewRes] = await Promise.all([
    result.borrower_ownership_entity_id
      ? sb
          .from("signed_documents")
          .select("signature_completed_at, expires_at")
          .eq("deal_id", dealId)
          .eq("form_code", SBA_NOTE_FORM_CODE)
          .eq("signer_ownership_entity_id", result.borrower_ownership_entity_id)
          .order("signature_completed_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sb
      .from("sba_legal_document_reviews")
      .select("status, reviewed_by, reviewed_at")
      .eq("deal_id", dealId)
      .eq("form_code", SBA_NOTE_FORM_CODE)
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
