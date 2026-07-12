/**
 * SPEC S4 G-2 — DB-aware wrapper around the pure buildForm912(). Same split
 * as form1919/buildWithSignature.ts and form4506c/buildWithSignature.ts.
 */

import { buildForm912, type Form912BuildResult } from "@/lib/sba/forms/form912/build";
import { buildForm912Input, type Form912InputBuilderClient } from "@/lib/sba/forms/form912/inputBuilder";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export async function buildForm912WithSignature(dealId: string, sb: Form912InputBuilderClient): Promise<Form912BuildResult> {
  const input = await buildForm912Input(dealId, sb);
  const result = buildForm912(input);

  if (!result.applicable) {
    return result;
  }

  const { data: signedDocs } = await sb
    .from("signed_documents")
    .select("signer_ownership_entity_id, signature_completed_at, expires_at")
    .eq("deal_id", dealId)
    .eq("form_code", "FORM_912");

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
