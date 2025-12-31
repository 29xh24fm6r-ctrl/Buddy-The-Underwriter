import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export type EnsuredDealBank = {
  ok: true;
  dealId: string;
  bankId: string;
  updated: boolean;
};

export type EnsuredDealBankErr = {
  ok: false;
  error: "deal_not_found" | "bank_context_missing" | "tenant_mismatch" | "bank_assign_failed";
  dealId: string;
  deal_bank_id?: string | null;
  user_bank_id?: string | null;
  details?: string;
};

/**
 * 🔥 CANONICAL DEAL+BANK ENFORCEMENT
 * 
 * Bank-grade access control for write operations:
 * 1. Load deal by id only (never filter by bank_id upfront)
 * 2. Resolve user's bank context (may auto-provision in dev)
 * 3. Enforce tenancy AFTER load (mismatch → 403)
 * 4. First-touch bank assignment (if deal has no bank yet)
 * 
 * This matches the /context endpoint contract exactly.
 */
export async function ensureDealBankAccess(dealId: string): Promise<EnsuredDealBank | EnsuredDealBankErr> {
  const sb = supabaseAdmin();

  // 1) Load deal by id only
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr) {
    return { ok: false, error: "deal_not_found", dealId, details: String(dealErr) };
  }
  if (!deal) {
    return { ok: false, error: "deal_not_found", dealId };
  }

  // 2) Resolve user bank context (may auto-provision in dev)
  let userBankId: string | null = null;
  try {
    userBankId = await getCurrentBankId();
  } catch (e) {
    console.error("[ensureDealBankAccess] getCurrentBankId failed:", e);
    userBankId = null;
  }

  // 3) Enforce tenancy AFTER load
  if (deal.bank_id && userBankId && deal.bank_id !== userBankId) {
    return {
      ok: false,
      error: "tenant_mismatch",
      dealId,
      deal_bank_id: deal.bank_id,
      user_bank_id: userBankId,
    };
  }

  // 4) First-touch bank assignment
  if (!deal.bank_id && userBankId) {
    const { error: updErr } = await sb.from("deals").update({ bank_id: userBankId }).eq("id", dealId);
    if (updErr) {
      return { ok: false, error: "bank_assign_failed", dealId, details: String(updErr) };
    }
    return { ok: true, dealId, bankId: userBankId, updated: true };
  }

  const ensured = deal.bank_id ?? userBankId;
  if (!ensured) {
    return { ok: false, error: "bank_context_missing", dealId };
  }

  return { ok: true, dealId, bankId: ensured, updated: false };
}
