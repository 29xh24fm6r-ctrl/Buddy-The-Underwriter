/**
 * SPEC S4 D-1 — DB-aware wrapper around the pure buildForm4506c(). Kept
 * separate from build.ts, same split as form1919/buildWithSignature.ts.
 */

import { buildForm4506c, type Form4506cBuildResult } from "@/lib/sba/forms/form4506c/build";
import { buildForm4506cInput, type Form4506cInputBuilderClient } from "@/lib/sba/forms/form4506c/inputBuilder";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export async function buildForm4506cWithSignature(
  dealId: string,
  bankId: string,
  sb: Form4506cInputBuilderClient,
): Promise<Form4506cBuildResult> {
  const input = await buildForm4506cInput(dealId, bankId, sb);
  const result = buildForm4506c(input);

  const { data: signedDocs } = await sb
    .from("signed_documents")
    .select("signer_ownership_entity_id, signature_completed_at, expires_at")
    .eq("deal_id", dealId)
    .eq("form_code", "FORM_4506C");

  const byOwner = new Map<string, { signature_completed_at: string; expires_at: string }>();
  for (const doc of (signedDocs ?? []) as Array<{ signer_ownership_entity_id: string; signature_completed_at: string; expires_at: string }>) {
    const existing = byOwner.get(doc.signer_ownership_entity_id);
    if (!existing || new Date(doc.signature_completed_at) > new Date(existing.signature_completed_at)) {
      byOwner.set(doc.signer_ownership_entity_id, doc);
    }
  }

  return {
    ...result,
    signatures: result.signatures.map((s) => {
      const doc = byOwner.get(s.ownership_entity_id);
      if (!doc) return s;
      const expiresAt = new Date(doc.expires_at);
      const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / MS_PER_DAY;
      return {
        ownership_entity_id: s.ownership_entity_id,
        has_valid_signature: expiresAt.getTime() > Date.now(),
        signed_at: doc.signature_completed_at,
        expires_at: doc.expires_at,
        needs_resignature: daysUntilExpiry <= RESIGN_WARNING_DAYS,
      };
    }),
  };
}
