/**
 * SPEC S4 G-3 — DB-aware wrapper. `buildForm155Input` already does the DB
 * work (deal-level applicability + field assembly), so this only adds the
 * signature lookup on top, same split as the rest of this arc's forms.
 */

import { buildForm155Input, type Form155InputBuilderClient } from "@/lib/sba/forms/form155/inputBuilder";
import type { Form155BuildResult } from "@/lib/sba/forms/form155/build";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export async function buildForm155WithSignature(dealId: string, bankId: string, sb: Form155InputBuilderClient): Promise<Form155BuildResult> {
  const result = await buildForm155Input(dealId, bankId, sb);

  if (!result.applicable || !result.borrower_ownership_entity_id) {
    return result;
  }

  const { data: signedDoc } = await sb
    .from("signed_documents")
    .select("signature_completed_at, expires_at")
    .eq("deal_id", dealId)
    .eq("form_code", "FORM_155")
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
    borrower_signature: {
      has_valid_signature: expiresAt.getTime() > Date.now(),
      signed_at: signedDoc.signature_completed_at,
      expires_at: signedDoc.expires_at,
      needs_resignature: daysUntilExpiry <= RESIGN_WARNING_DAYS,
    },
  };
}
