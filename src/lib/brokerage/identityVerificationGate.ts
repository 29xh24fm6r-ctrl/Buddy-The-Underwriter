/**
 * Ticket 2 (SPEC-BROKERAGE-SBA-READY-V1) — shared helper so the sealing
 * gate (sealingGate.ts) and the borrower-facing status card
 * (/api/brokerage/deals/[dealId]/kyc) agree on exactly which owners need
 * IAL2 identity verification. Kept free of "server-only" so it stays
 * testable under plain `node --test`, same pattern as kyc/service.ts.
 *
 * Default decision (no written spec existed for Ticket 2 — see the T2 AAR):
 * identity verification gates SEALING (listing on the marketplace), not
 * e-signature. Rationale: IAL2 establishes the package's authenticity for
 * every matched lender viewing a blind listing, independent of which
 * lender eventually wins — the same "prove this deal is real before we
 * show it to lenders" role the existing score/eligibility/validation
 * gates already play in canSeal().
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasValidIal2 } from "@/lib/identity/kyc/service";
import { requiresPersonalPackage } from "@/lib/ownership/rules";

export async function ownersNeedingIal2(
  dealId: string,
  sb: SupabaseClient,
): Promise<Array<{ id: string; display_name: string | null }>> {
  const { data: owners } = await sb
    .from("ownership_entities")
    .select("id, display_name, ownership_pct")
    .eq("deal_id", dealId);

  const owing = ((owners ?? []) as Array<Record<string, any>>).filter((o) =>
    requiresPersonalPackage(o.ownership_pct),
  );

  const unverified: Array<{ id: string; display_name: string | null }> = [];
  for (const owner of owing) {
    const valid = await hasValidIal2(dealId, owner.id, sb as any);
    if (!valid) unverified.push({ id: owner.id, display_name: owner.display_name });
  }
  return unverified;
}
