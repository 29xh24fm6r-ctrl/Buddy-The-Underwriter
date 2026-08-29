/**
 * Marketplace listing cadence engine.
 *
 * Sealing creates a listing in `pending_preview` with preview/claim window
 * timestamps. This worker advances listings only after every required read,
 * lender-notification admission, and compare-and-set write is proven.
 *
 *   pending_preview ──(claim_opens_at ≤ now)──▶ claiming   (+ claim_window_open comms)
 *   claiming / awaiting_borrower_pick ──(claim_closes_at ≤ now, no pick)──▶ expired
 *
 * `picked` is a terminal state set by the borrower pick route, not here.
 */

import { queueLenderMessage } from "./lenderComms";

type SB = { from: (t: string) => any };
type QueryError = { message?: string } | null | undefined;

export type CadenceResult = {
  opened: number;
  expired: number;
  commsQueued: number;
};

function dbMessage(error: QueryError): string {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : "database_error";
}

function assertDbOk(error: QueryError, operation: string): void {
  if (error) throw new Error(`[marketplace-cadence] ${operation}: ${dbMessage(error)}`);
}

export async function advanceMarketplaceListings(
  sb: SB,
  now: Date = new Date(),
): Promise<CadenceResult> {
  const iso = now.toISOString();
  let opened = 0;
  let expired = 0;
  let commsQueued = 0;

  // 1. Admit every matched lender notification before opening the claim
  // window. Cooldown suppression makes retries idempotent. If any admission
  // fails, the listing stays pending_preview and the next cron can converge.
  const { data: toOpen, error: toOpenError } = await sb
    .from("marketplace_listings")
    .select("id, deal_id, matched_lender_bank_ids")
    .eq("status", "pending_preview")
    .lte("claim_opens_at", iso);
  assertDbOk(toOpenError, "open_candidates_read");

  for (const l of (toOpen ?? []) as any[]) {
    const matched = Array.isArray(l.matched_lender_bank_ids)
      ? l.matched_lender_bank_ids
      : [];

    for (const lenderBankId of matched) {
      const queued = await queueLenderMessage(
        "claim_window_open",
        { dealId: l.deal_id, listingId: l.id, lenderBankId, stage: "claim" },
        "email",
        sb,
      );
      if (!queued.ok) {
        throw new Error(
          `[marketplace-cadence] claim_window_notification:${String(l.id)}:${String(lenderBankId)}:${queued.error}`,
        );
      }
      if (!queued.suppressed) commsQueued++;
    }

    // Conditional update guards against a concurrent runner double-advancing.
    const { data: updated, error: updateError } = await sb
      .from("marketplace_listings")
      .update({ status: "claiming", updated_at: iso })
      .eq("id", l.id)
      .eq("status", "pending_preview")
      .select("id")
      .maybeSingle();
    assertDbOk(updateError, `open_listing:${String(l.id)}`);
    if (!updated) continue;
    opened++;
  }

  // 2. Expire un-picked listings whose claim window has closed. Prove the
  // selected status and returned row so races never count as successful work.
  const { data: toExpire, error: toExpireError } = await sb
    .from("marketplace_listings")
    .select("id, status")
    .in("status", ["claiming", "awaiting_borrower_pick"])
    .lte("claim_closes_at", iso)
    .is("picked_at", null);
  assertDbOk(toExpireError, "expiration_candidates_read");

  for (const l of (toExpire ?? []) as any[]) {
    const { data: updated, error: updateError } = await sb
      .from("marketplace_listings")
      .update({ status: "expired", expired_at: iso, updated_at: iso })
      .eq("id", l.id)
      .eq("status", l.status)
      .is("picked_at", null)
      .select("id")
      .maybeSingle();
    assertDbOk(updateError, `expire_listing:${String(l.id)}`);
    if (!updated) continue;
    expired++;
  }

  return { opened, expired, commsQueued };
}
