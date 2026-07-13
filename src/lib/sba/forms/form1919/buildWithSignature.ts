/**
 * SPEC S3 D-2 — DB-aware wrapper around the pure buildForm1919(). Kept in
 * a separate file (not build.ts itself) to avoid a build.ts <-> inputBuilder.ts
 * import cycle and to keep buildForm1919() itself pure and dependency-free.
 */

import { buildForm1919, type Form1919BuildResult } from "@/lib/sba/forms/form1919/build";
import { buildForm1919Input, type Form1919InputBuilderClient } from "@/lib/sba/forms/form1919/inputBuilder";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export async function buildForm1919WithSignature(
  dealId: string,
  sb: Form1919InputBuilderClient,
): Promise<Form1919BuildResult> {
  const input = await buildForm1919Input(dealId, sb);
  const result = buildForm1919(input);

  const { data: signedDoc } = await sb
    .from("signed_documents")
    .select("signature_completed_at, expires_at")
    .eq("deal_id", dealId)
    .eq("form_code", "FORM_1919")
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
