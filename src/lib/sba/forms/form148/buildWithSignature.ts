/**
 * SPEC S7 (ARC-00 Phase 5) — DB-aware wrapper. `form_code` in
 * `signed_documents` is `FORM_148` or `FORM_148L` depending on the
 * signer's guaranteeType — the two variants render.ts fills from the same
 * underlying form. Not yet wired into the e-sign panel's
 * resolveFilledPdfForSigning.ts dispatch (SbaSigningPanel.tsx's
 * TRACKED_FORMS only covers 1919/413/912/4506-C today); a future signing
 * flow for 148/148L can add a case there the same way those four were.
 */

import { buildForm148, type Form148BuildResult } from "@/lib/sba/forms/form148/build";
import { buildForm148Input, type Form148InputBuilderClient } from "@/lib/sba/forms/form148/inputBuilder";

const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export async function buildForm148WithSignature(
  dealId: string,
  bankId: string,
  sb: Form148InputBuilderClient,
): Promise<Form148BuildResult> {
  const input = await buildForm148Input(dealId, bankId, sb);
  const result = buildForm148(input);

  const { data: signedDocs } = await sb
    .from("signed_documents")
    .select("signer_ownership_entity_id, form_code, signature_completed_at, expires_at")
    .eq("deal_id", dealId)
    .in("form_code", ["FORM_148", "FORM_148L"]);

  const byOwner = new Map<string, { signature_completed_at: string; expires_at: string }>();
  for (const doc of (signedDocs ?? []) as Array<{ signer_ownership_entity_id: string; form_code: string; signature_completed_at: string; expires_at: string }>) {
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
        ...s,
        has_valid_signature: expiresAt.getTime() > Date.now(),
        signed_at: doc.signature_completed_at,
        expires_at: doc.expires_at,
        needs_resignature: daysUntilExpiry <= RESIGN_WARNING_DAYS,
      };
    }),
  };
}
