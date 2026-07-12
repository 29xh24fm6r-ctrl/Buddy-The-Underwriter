/**
 * SPEC S3 D-2 — DB-aware wrapper around the pure buildForm413(). Each
 * signer's signature status is overridden with the real signed_documents
 * row for that (deal_id, FORM_413, ownership_entity_id) when one exists —
 * the pure build() function only knows about a manually-reported
 * `signed_at` field, which predates real e-sign wiring.
 */

import { buildForm413, type Form413BuildResult } from "@/lib/sba/forms/form413/build";
import { buildForm413Input, type Form413InputBuilderClient } from "@/lib/sba/forms/form413/inputBuilder";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export async function buildForm413WithSignature(
  dealId: string,
  sb: Form413InputBuilderClient,
): Promise<Form413BuildResult> {
  const input = await buildForm413Input(dealId, sb);
  const result = buildForm413(input);

  const { data: signedDocs } = await sb
    .from("signed_documents")
    .select("signer_ownership_entity_id, signature_completed_at, expires_at")
    .eq("deal_id", dealId)
    .eq("form_code", "FORM_413");

  const byOwner = new Map<string, { signature_completed_at: string; expires_at: string }>();
  for (const doc of (signedDocs ?? []) as Array<{ signer_ownership_entity_id: string; signature_completed_at: string; expires_at: string }>) {
    const existing = byOwner.get(doc.signer_ownership_entity_id);
    if (!existing || new Date(doc.signature_completed_at) > new Date(existing.signature_completed_at)) {
      byOwner.set(doc.signer_ownership_entity_id, doc);
    }
  }

  const signatures = result.signatures.map((sig) => {
    const doc = byOwner.get(sig.ownership_entity_id);
    if (!doc) return sig;

    const expiresAt = new Date(doc.expires_at);
    const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / MS_PER_DAY;

    return {
      ownership_entity_id: sig.ownership_entity_id,
      has_valid_signature: expiresAt.getTime() > Date.now(),
      signed_at: doc.signature_completed_at,
      expires_at: doc.expires_at,
      needs_resignature: daysUntilExpiry <= RESIGN_WARNING_DAYS,
    };
  });

  return {
    ...result,
    signatures,
    is_complete: result.missing.every((m) => m.missing.length === 0) && signatures.every((s) => !s.needs_resignature),
  };
}
