/**
 * SPEC S7 (ARC-00 Phase 5) — DB-aware wrapper. Same split as
 * form155/buildWithSignature.ts.
 */

import { buildForm601Input, type Form601InputBuilderClient } from "@/lib/sba/forms/form601/inputBuilder";
import type { Form601BuildResult } from "@/lib/sba/forms/form601/build";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export async function buildForm601WithSignature(dealId: string, bankId: string, sb: Form601InputBuilderClient): Promise<Form601BuildResult> {
  const result = await buildForm601Input(dealId, bankId, sb);

  if (!result.applicable || !result.borrower_ownership_entity_id) {
    return result;
  }

  const { data: signedDoc } = await sb
    .from("signed_documents")
    .select("signature_completed_at, expires_at")
    .eq("deal_id", dealId)
    .eq("form_code", "FORM_601")
    .eq("signer_ownership_entity_id", result.borrower_ownership_entity_id)
    .order("signature_completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!signedDoc) {
    return result;
  }

  const expiresAt = new Date(signedDoc.expires_at);
  const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / MS_PER_DAY;

  return {
    ...result,
    signature: {
      has_valid_signature: expiresAt.getTime() > Date.now(),
      signed_at: signedDoc.signature_completed_at,
      expires_at: signedDoc.expires_at,
      needs_resignature: daysUntilExpiry <= RESIGN_WARNING_DAYS,
    },
  };
}
