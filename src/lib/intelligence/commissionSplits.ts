import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "./types";

/**
 * Commission-split tracking — spec section 7.4 ("referral fee, co-broker
 * split, internal commission split"). Payee identity is never entered
 * here directly: it is read from deal_source_attribution (PR1's
 * authoritative referral/co-broker attribution) and deal_participants
 * (role='broker'/'co_broker', PR3's widened internal-staff role set), so
 * this table only ever adds the one fact that didn't already exist
 * anywhere — a split amount tied to a real fee, with its own payment
 * status.
 */

export type CommissionSplitRow = {
  id: string;
  bank_id: string;
  deal_id: string;
  fee_ledger_id: string | null;
  split_type: "referral_partner" | "co_broker" | "internal_broker";
  payee_org_id: string | null;
  payee_clerk_user_id: string | null;
  split_bps: number | null;
  amount_cents: number | null;
  status: "estimated" | "confirmed" | "paid";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_REFERRAL_PARTNER_SPLIT_BPS = 2000; // 20% of the lender-referral fee, editable per deal
const DEFAULT_INTERNAL_BROKER_SPLIT_BPS = 5000; // 50% of net brokerage revenue, editable per deal

function feeAmountForSplit(feeAmountCents: number | null, splitBps: number | null): number | null {
  if (feeAmountCents == null || splitBps == null) return null;
  return Math.round((feeAmountCents * splitBps) / 10000);
}

/**
 * Idempotently creates commission-split rows for a deal from its
 * existing referral/co-broker/internal-broker attribution, if they don't
 * already exist. Safe to call more than once (e.g. once at conversion,
 * again after the lender-referral fee is finalized at funding) — never
 * creates a duplicate split for the same (deal, split_type, payee).
 */
export async function initializeCommissionSplitsForDeal(
  bankId: string,
  dealId: string,
  sb: SB = supabaseAdmin(),
): Promise<{ created: number; skipped: number }> {
  const { data: attribution } = await sb
    .from("deal_source_attribution")
    .select("referring_organization_id, co_broker_org_id, attribution_percentage")
    .eq("deal_id", dealId)
    .maybeSingle();
  const attr = attribution as { referring_organization_id: string | null; co_broker_org_id: string | null; attribution_percentage: number | null } | null;

  const { data: participants } = await sb
    .from("deal_participants")
    .select("clerk_user_id, role, is_active")
    .eq("deal_id", dealId)
    .in("role", ["broker", "co_broker"])
    .eq("is_active", true);
  const brokers = ((participants ?? []) as Array<{ clerk_user_id: string; role: string }>).filter((p) => p.role === "broker");

  const { data: feeLedgerRows } = await sb
    .from("brokerage_fee_ledger")
    .select("id, fee_type")
    .eq("deal_id", dealId);
  const referralFee = ((feeLedgerRows ?? []) as Array<{ id: string; fee_type: string }>).find((f) => f.fee_type === "lender_referral");
  const referralFeeLedgerId = referralFee?.id ?? null;

  const { data: existing } = await sb.from("brokerage_commission_splits").select("split_type, payee_org_id, payee_clerk_user_id").eq("deal_id", dealId);
  const existingKeys = new Set(
    ((existing ?? []) as Array<{ split_type: string; payee_org_id: string | null; payee_clerk_user_id: string | null }>).map(
      (e) => `${e.split_type}:${e.payee_org_id ?? e.payee_clerk_user_id}`,
    ),
  );

  let created = 0;
  let skipped = 0;

  const toInsert: Array<Partial<CommissionSplitRow>> = [];

  if (attr?.referring_organization_id) {
    const key = `referral_partner:${attr.referring_organization_id}`;
    if (!existingKeys.has(key)) {
      const bps = attr.attribution_percentage != null ? Math.round(attr.attribution_percentage * 100) : DEFAULT_REFERRAL_PARTNER_SPLIT_BPS;
      toInsert.push({
        bank_id: bankId,
        deal_id: dealId,
        fee_ledger_id: referralFeeLedgerId,
        split_type: "referral_partner",
        payee_org_id: attr.referring_organization_id,
        split_bps: bps,
        status: "estimated",
      });
    } else skipped++;
  }

  if (attr?.co_broker_org_id) {
    const key = `co_broker:${attr.co_broker_org_id}`;
    if (!existingKeys.has(key)) {
      toInsert.push({
        bank_id: bankId,
        deal_id: dealId,
        fee_ledger_id: referralFeeLedgerId,
        split_type: "co_broker",
        payee_org_id: attr.co_broker_org_id,
        split_bps: DEFAULT_REFERRAL_PARTNER_SPLIT_BPS,
        status: "estimated",
      });
    } else skipped++;
  }

  for (const broker of brokers) {
    const key = `internal_broker:${broker.clerk_user_id}`;
    if (!existingKeys.has(key)) {
      toInsert.push({
        bank_id: bankId,
        deal_id: dealId,
        fee_ledger_id: referralFeeLedgerId,
        split_type: "internal_broker",
        payee_clerk_user_id: broker.clerk_user_id,
        split_bps: Math.round(DEFAULT_INTERNAL_BROKER_SPLIT_BPS / Math.max(1, brokers.length)),
        status: "estimated",
      });
    } else skipped++;
  }

  if (toInsert.length > 0) {
    await sb.from("brokerage_commission_splits").insert(toInsert);
    created = toInsert.length;
  }

  return { created, skipped };
}

export async function listCommissionSplitsForDeal(bankId: string, dealId: string, sb: SB = supabaseAdmin()): Promise<CommissionSplitRow[]> {
  const { data } = await sb.from("brokerage_commission_splits").select("*").eq("bank_id", bankId).eq("deal_id", dealId).order("created_at", { ascending: true });
  return (data ?? []) as CommissionSplitRow[];
}

/**
 * Recomputes amount_cents for every split on a deal from the current fee
 * amount on its linked fee_ledger row and each split's own split_bps —
 * call this after calculateFinalLenderReferralFee / markFeesFunded
 * updates the ledger amount at funding.
 */
export async function recalculateCommissionSplitAmounts(bankId: string, dealId: string, sb: SB = supabaseAdmin()): Promise<{ updated: number }> {
  const splits = await listCommissionSplitsForDeal(bankId, dealId, sb);
  const feeLedgerIds = Array.from(new Set(splits.map((s) => s.fee_ledger_id).filter((id): id is string => Boolean(id))));
  if (feeLedgerIds.length === 0) return { updated: 0 };

  const { data: fees } = await sb.from("brokerage_fee_ledger").select("id, amount_cents").in("id", feeLedgerIds);
  const feeAmountById = new Map(((fees ?? []) as Array<{ id: string; amount_cents: number | null }>).map((f) => [f.id, f.amount_cents]));

  let updated = 0;
  for (const split of splits) {
    if (!split.fee_ledger_id) continue;
    const feeAmountCents = feeAmountById.get(split.fee_ledger_id) ?? null;
    const amountCents = feeAmountForSplit(feeAmountCents ?? null, split.split_bps);
    if (amountCents == null) continue;
    await sb.from("brokerage_commission_splits").update({ amount_cents: amountCents }).eq("id", split.id);
    updated++;
  }
  return { updated };
}

export async function updateCommissionSplitStatus(
  bankId: string,
  splitId: string,
  status: "estimated" | "confirmed" | "paid",
  sb: SB = supabaseAdmin(),
): Promise<void> {
  await sb.from("brokerage_commission_splits").update({ status }).eq("id", splitId).eq("bank_id", bankId);
}
