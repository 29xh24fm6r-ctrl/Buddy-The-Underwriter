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
import { requiresPersonalPackage } from "@/lib/ownership/rules";
import { TERMINAL_SUCCESS_STATUSES } from "@/lib/identity/kyc/service";

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

  if (owing.length === 0) return [];

  // One set-based verification lookup replaces the former query-per-owner
  // loop. seal-status is polled frequently, so the N+1 path multiplied both
  // latency and database load for every borrower page with several owners.
  const ownerIds = owing.map((owner) => String(owner.id));
  const { data: verifications } = await sb
    .from("borrower_identity_verifications")
    .select("ownership_entity_id")
    .eq("deal_id", dealId)
    .in("ownership_entity_id", ownerIds)
    // Single source of truth with hasValidIal2 and the rest of the KYC
    // service. A hardcoded copy here silently diverges: add a terminal
    // status and verified owners read as unverified (sealing blocks);
    // remove an unsafe one and this gate keeps honouring it (audit F-14).
    .in("status", TERMINAL_SUCCESS_STATUSES)
    .not("completed_at", "is", null);

  const verifiedOwnerIds = new Set(
    ((verifications ?? []) as Array<{ ownership_entity_id?: string | null }>)
      .map((row) => row.ownership_entity_id)
      .filter((id): id is string => Boolean(id)),
  );

  return owing
    .filter((owner) => !verifiedOwnerIds.has(String(owner.id)))
    .map((owner) => ({ id: String(owner.id), display_name: owner.display_name ?? null }));
}
