/**
 * Marketplace listing cadence engine.
 *
 * Sealing creates a listing in `pending_preview` with preview/claim window
 * timestamps, but nothing advanced its status in production — so a sealed listing
 * could never reach `claiming` and no lender could ever act on it (audit C2). This
 * runs on a cron and moves listings through their lifecycle by wall-clock:
 *
 *   pending_preview ──(claim_opens_at ≤ now)──▶ claiming   (+ claim_window_open comms)
 *   claiming / awaiting_borrower_pick ──(claim_closes_at ≤ now, no pick)──▶ expired
 *
 * `picked` is a terminal state set by the borrower pick route, not here.
 */

import { queueLenderMessage } from "./lenderComms";

type SB = { from: (t: string) => any };

export type CadenceResult = {
  opened: number;
  expired: number;
  commsQueued: number;
};

export async function advanceMarketplaceListings(
  sb: SB,
  now: Date = new Date(),
): Promise<CadenceResult> {
  const iso = now.toISOString();
  let opened = 0;
  let expired = 0;
  let commsQueued = 0;

  // 1. Open the claim window: pending_preview → claiming.
  const { data: toOpen } = await sb
    .from("marketplace_listings")
    .select("id, deal_id, matched_lender_bank_ids")
    .eq("status", "pending_preview")
    .lte("claim_opens_at", iso);

  for (const l of (toOpen ?? []) as any[]) {
    // Conditional update guards against a concurrent runner double-advancing.
    const { data: updated, error } = await sb
      .from("marketplace_listings")
      .update({ status: "claiming", updated_at: iso })
      .eq("id", l.id)
      .eq("status", "pending_preview")
      .select("id");
    if (error || !updated || (updated as any[]).length === 0) continue;
    opened++;

    const matched = Array.isArray(l.matched_lender_bank_ids)
      ? l.matched_lender_bank_ids
      : [];
    for (const lenderBankId of matched) {
      const r = await queueLenderMessage(
        "claim_window_open",
        { dealId: l.deal_id, listingId: l.id, lenderBankId, stage: "claim" },
        "email",
        sb,
      );
      if (r.ok && !r.suppressed) commsQueued++;
    }
  }

  // 2. Expire un-picked listings whose claim window has closed.
  const { data: toExpire } = await sb
    .from("marketplace_listings")
    .select("id")
    .in("status", ["claiming", "awaiting_borrower_pick"])
    .lte("claim_closes_at", iso)
    .is("picked_at", null);

  for (const l of (toExpire ?? []) as any[]) {
    const { error } = await sb
      .from("marketplace_listings")
      .update({ status: "expired", expired_at: iso, updated_at: iso })
      .eq("id", l.id)
      .is("picked_at", null);
    if (!error) expired++;
  }

  return { opened, expired, commsQueued };
}
