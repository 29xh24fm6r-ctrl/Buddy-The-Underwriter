import { getCurrentBankId } from "./getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

type EnsureResult =
  | { ok: true; dealId: string; bankId: string }
  | { ok: false; error: "deal_not_found" | "tenant_mismatch" | "unauthorized" };

/**
 * Ensures the current user has access to a deal through their bank membership.
 * Returns the deal's bank_id on success.
 */
export async function ensureDealBankAccess(dealId: string): Promise<EnsureResult> {
  try {
    const userBankId = await getCurrentBankId();
    
    const sb = supabaseAdmin();
    const { data: deal, error } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (error || !deal) {
      return { ok: false, error: "deal_not_found" };
    }

    if (deal.bank_id !== userBankId) {
      return { ok: false, error: "tenant_mismatch" };
    }

    return { ok: true, dealId: deal.id, bankId: deal.bank_id };
  } catch (e) {
    console.error("[ensureDealBankAccess] error:", e);
    return { ok: false, error: "unauthorized" };
  }
}
