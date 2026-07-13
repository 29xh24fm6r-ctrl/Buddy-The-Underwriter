/**
 * SPEC S6 (ARC-00 Phase 4) — DB-aware wrapper around the pure
 * buildForm1244(). Same split as form1919/buildWithSignature.ts.
 */

import { buildForm1244, type Form1244BuildResult } from "@/lib/sba/forms/form1244/build";
import { buildForm1244Input, type Form1244InputBuilderClient } from "@/lib/sba/forms/form1244/inputBuilder";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export async function buildForm1244WithSignature(
  dealId: string,
  sb: Form1244InputBuilderClient,
): Promise<Form1244BuildResult> {
  const input = await buildForm1244Input(dealId, sb);
  const result = buildForm1244(input);

  const { data: signedDoc } = await sb
    .from("signed_documents")
    .select("signature_completed_at, expires_at")
    .eq("deal_id", dealId)
    .eq("form_code", "FORM_1244")
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
